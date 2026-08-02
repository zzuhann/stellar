import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ImportService } from '../services/importService';
import { ImageService } from '../services/imageService';
import { hasR2Config } from '../config/r2-client';

export class ImportController {
  private importService: ImportService;
  private imageService: ImageService;

  constructor() {
    this.importService = new ImportService();
    this.imageService = new ImageService();
  }

  // 貼文文案原文 → Gemini 結構化解析
  // 注意：ImportService.parseCaption 內部已經把「預期內的業務失敗」（Gemini 額度用完、
  // 回應格式不符等）自己 catch 起來，回傳 success:false 的結果物件，不會用 throw 表達。
  // 所以這裡的 catch 只會接到真正未預期的例外（例如 resolveLocation 內部拋出的錯誤），
  // 一律 next(error) 交給全域 error handler，不要自己包裝成「AI 服務暫時無法使用」
  // 這種業務失敗訊息，否則會把未預期的 server error 誤報成 Gemini 額度/服務問題。
  parseCaption = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({ success: false, error: 'AI 解析服務未設定' });
      return;
    }

    try {
      const { caption } = req.body as { caption: string };
      const result = await this.importService.parseCaption(caption);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  // 外部圖片網址 → 伺服器抓取後跑既有驗證＋R2 上傳，回傳 R2 網址
  // 同上：ImageService.uploadImageFromUrl 內部已把預期內的業務失敗（SSRF 擋下、格式不符、
  // 檔案過大等）包成 success:false 回傳，這裡的 catch 只處理真正未預期的例外，一律 next(error)。
  fetchImage = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!hasR2Config) {
      res.status(503).json({ success: false, error: '圖片上傳服務未設定' });
      return;
    }

    try {
      const { imageUrl } = req.body as { imageUrl: string };
      const result = await this.imageService.uploadImageFromUrl(imageUrl);

      if (result.success) {
        res.status(200).json({
          success: true,
          imageUrl: result.imageUrl,
          filename: result.filename,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          reason: result.reason,
        });
      }
    } catch (error) {
      next(error);
    }
  };
}
