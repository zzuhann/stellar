import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, hasR2Config, R2_BUCKET_NAME, R2_PUBLIC_URL } from '../config/r2-client';
import crypto from 'crypto';
import path from 'path';

export interface UploadResult {
  success: boolean;
  imageUrl?: string;
  filename?: string;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export class ImageService {
  private checkR2Config() {
    if (!hasR2Config || !r2Client) {
      throw new Error('R2 not configured');
    }
  }

  // 驗證檔案類型
  private validateFile(file: Express.Multer.File): { valid: boolean; error?: string } {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    // 檢查檔案大小
    if (file.size > maxSize) {
      return { valid: false, error: '檔案過大' };
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

    return { valid: true };
  }

  // 生成唯一檔名
  private generateFilename(originalName: string): string {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(originalName).toLowerCase();
    return `images/${timestamp}-${randomString}${ext}`;
  }

  // 上傳圖片到 R2
  async uploadImage(file: Express.Multer.File): Promise<UploadResult> {
    try {
      this.checkR2Config();

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
    } catch (error) {
      console.error('Error uploading image:', error);
      return {
        success: false,
        error: '上傳失敗',
      };
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
