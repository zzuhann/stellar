import { PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { r2Client, hasR2Config, R2_BUCKET_NAME, R2_PUBLIC_URL } from '../config/r2-client';
import { fetchWithSsrfGuard } from '../utils/ssrfGuard';
import crypto from 'crypto';
import path from 'path';

export interface UploadResult {
  success: boolean;
  imageUrl?: string;
  filename?: string;
  error?: string;
}

export type FetchImageFailureReason =
  | 'fetch_failed'
  | 'invalid_content_type'
  | 'unsupported_format'
  | 'size_out_of_range'
  | 'blocked_host';

export interface FetchImageResult extends UploadResult {
  reason?: FetchImageFailureReason;
}

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FETCH_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB，與既有 validateFile 上限一致

// content-type → 副檔名對應表，用於 uploadImageFromUrl 組 pseudoFile.originalname。
// 不能相信來源網址路徑本身的副檔名：CDN（例如 IG）常見用內部／歷史命名，副檔名
// 跟實際 served 的 content-type 可能不一致（例如路徑是 .heic，但 content-type 是
// image/jpeg），若拿路徑副檔名去跑 validateFile 的副檔名檢查，會誤擋掉合法圖片。
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// 邊讀邊計數位元組，超過上限立即中止連線，不等下載完才判斷過大
// （來源不受信任，提早擋比 validateFile 現有的「先有完整 buffer 才檢查大小」更安全）
async function readWithSizeCap(
  response: globalThis.Response,
  maxBytes: number
): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    // 環境不支援 streaming body 時的 fallback：讀完整個回應再檢查大小
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > maxBytes ? null : buffer;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface R2HealthResult {
  reachable: boolean;
  error?: string;
}

export class ImageService {
  private checkR2Config() {
    if (!hasR2Config || !r2Client) {
      throw new Error('R2 問題，請檢查環境變數');
    }
  }

  // 檢查 buffer 開頭是否符合指定 magic bytes
  private matchesMagicBytes(buffer: Buffer, signature: number[]): boolean {
    if (buffer.length < signature.length) {
      return false;
    }
    return signature.every((byte, index) => buffer[index] === byte);
  }

  // 檢查 buffer 實際內容是否為宣稱的 mimetype 對應的真實圖片格式
  private isValidImageContent(buffer: Buffer, mimetype: string): boolean {
    switch (mimetype) {
      case 'image/jpeg':
      case 'image/jpg':
        return this.matchesMagicBytes(buffer, [0xff, 0xd8, 0xff]);
      case 'image/png':
        return this.matchesMagicBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case 'image/webp':
        return (
          buffer.length >= 12 &&
          buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP'
        );
      default:
        return false;
    }
  }

  // 驗證檔案類型
  private validateFile(file: Express.Multer.File): { valid: boolean; error?: string } {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB
    const minSize = 1024; // 1KB，真實圖片不可能小於此大小

    // 檢查檔案大小上限
    if (file.size > maxSize) {
      return { valid: false, error: '檔案過大' };
    }

    // 檢查檔案大小下限
    if (file.size < minSize) {
      return { valid: false, error: '檔案過小或內容不完整' };
    }

    // 檢查 MIME type
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return { valid: false, error: '檔案格式不支援' };
    }

    // 檢查副檔名
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return { valid: false, error: '檔案格式不支援' };
    }

    // 檢查 magic bytes：檔案實際內容需與宣稱的 mimetype 相符，避免偽造 header 的假圖片
    if (!this.isValidImageContent(file.buffer, file.mimetype)) {
      return { valid: false, error: '檔案格式不支援' };
    }

    return { valid: true };
  }

  // 生成唯一檔名
  private generateFilename(originalName: string): string {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(originalName).toLowerCase();
    return `images/${timestamp}-${randomString}${ext}`;
  }

  // 驗證 → 產生檔名 → 上傳到 R2，這段邏輯同時被「使用者上傳檔案」與「伺服器抓取外部網址」兩個
  // public method 共用，不重複寫兩次
  private async persistValidatedFile(file: Express.Multer.File): Promise<UploadResult> {
    // 驗證檔案
    const validation = this.validateFile(file);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    // 生成檔名
    const filename = this.generateFilename(file.originalname);

    // 準備上傳參數
    const uploadParams = {
      Bucket: R2_BUCKET_NAME,
      Key: filename,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentLength: file.size,
    };

    // 上傳到 R2
    const command = new PutObjectCommand(uploadParams);
    await r2Client!.send(command);

    // 建構公開 URL
    const imageUrl = `${R2_PUBLIC_URL}/${filename}`;

    return {
      success: true,
      imageUrl,
      filename,
    };
  }

  // 上傳圖片到 R2（使用者本機檔案）
  async uploadImage(file: Express.Multer.File): Promise<UploadResult> {
    try {
      this.checkR2Config();
      return await this.persistValidatedFile(file);
    } catch (error) {
      console.error('Error uploading image:', error);
      return {
        success: false,
        error: '上傳失敗',
      };
    }
  }

  // 輸入外部圖片網址，伺服器抓取後跑既有驗證＋R2 上傳邏輯，回傳 R2 網址。
  // 供貼文匯入輔助（Phase A）使用，封面圖與詳細圖片共用同一支方法，見
  // specs/features/event-import-assistant/design-backend.md〈圖片抓取共用邏輯〉。
  async uploadImageFromUrl(sourceUrl: string): Promise<FetchImageResult> {
    try {
      this.checkR2Config();
    } catch (error) {
      console.error('Error uploading image from URL:', error);
      return { success: false, error: '圖片上傳服務未設定' };
    }

    const fetchResult = await fetchWithSsrfGuard(sourceUrl, { timeoutMs: 8000 });
    if (!fetchResult.ok || !fetchResult.response) {
      return {
        success: false,
        error: fetchResult.error ?? '圖片抓取失敗',
        reason: fetchResult.reason,
      };
    }

    const response = fetchResult.response;
    if (!response.ok) {
      return {
        success: false,
        error: '來源圖片無法取得，網址可能已失效',
        reason: 'fetch_failed',
      };
    }

    const contentType =
      response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(contentType)) {
      return {
        success: false,
        error: '來源網址不是支援的圖片格式',
        reason: 'invalid_content_type',
      };
    }

    let buffer: Buffer | null;
    try {
      buffer = await readWithSizeCap(response, MAX_FETCH_IMAGE_BYTES);
    } catch (error) {
      console.error('Error reading fetched image body:', error);
      return { success: false, error: '圖片下載失敗', reason: 'fetch_failed' };
    }
    if (!buffer) {
      return { success: false, error: '圖片檔案過大', reason: 'size_out_of_range' };
    }

    // 副檔名從已驗證過的 contentType 推導，不用來源網址路徑的副檔名（不可靠，見上方常數註解）
    const ext = CONTENT_TYPE_TO_EXT[contentType] ?? '';
    const pseudoFile = {
      buffer,
      mimetype: contentType,
      size: buffer.length,
      originalname: `image${ext}`,
    } as Express.Multer.File;

    try {
      const result = await this.persistValidatedFile(pseudoFile);
      if (!result.success) {
        // 到這一步 content-type／大小都已篩過，剩下的 validateFile 失敗
        // （magic bytes 不符、檔案過小）代表內容並非宣稱的圖片格式
        return { ...result, reason: 'unsupported_format' };
      }
      return result;
    } catch (error) {
      console.error('Error persisting fetched image:', error);
      return { success: false, error: '上傳失敗', reason: 'fetch_failed' };
    }
  }

  // 從 R2 刪除圖片
  async deleteImage(imageUrl: string): Promise<DeleteResult> {
    try {
      this.checkR2Config();

      // 從 URL 解析檔案路徑
      const filename = this.extractFilenameFromUrl(imageUrl);
      if (!filename) {
        return {
          success: false,
          error: '無效的圖片 URL',
        };
      }

      // 準備刪除參數
      const deleteParams = {
        Bucket: R2_BUCKET_NAME,
        Key: filename,
      };

      // 從 R2 刪除
      const command = new DeleteObjectCommand(deleteParams);
      await r2Client!.send(command);

      return {
        success: true,
      };
    } catch (error) {
      console.error('Error deleting image:', error);
      return {
        success: false,
        error: '刪除失敗',
      };
    }
  }

  // 從 URL 提取檔案路徑
  private extractFilenameFromUrl(imageUrl: string): string | null {
    try {
      // 檢查是否是我們的 R2 URL
      if (!imageUrl.startsWith(R2_PUBLIC_URL)) {
        return null;
      }

      // 提取路徑部分
      const url = new URL(imageUrl);
      const pathname = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;

      // 確保是 images/ 開頭的路徑
      if (!pathname.startsWith('images/')) {
        return null;
      }

      return pathname;
    } catch (error) {
      console.error('Error extracting filename from URL:', error);
      return null;
    }
  }

  // 實際打 R2 網路連線健康檢查，只確認 bucket 連得到，不建立/刪除任何檔案
  async checkR2Health(): Promise<R2HealthResult> {
    try {
      this.checkR2Config();
      await r2Client!.send(new HeadBucketCommand({ Bucket: R2_BUCKET_NAME }));
      return { reachable: true };
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : '未知錯誤',
      };
    }
  }

  // 檢查 R2 服務狀態
  getServiceStatus(): { available: boolean; message: string } {
    if (!hasR2Config) {
      return {
        available: false,
        message: 'R2 not configured',
      };
    }

    return {
      available: true,
      message: 'R2 service ready',
    };
  }
}
