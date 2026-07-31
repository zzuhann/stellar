import { Response } from 'express';
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
  parseCaption = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({ success: false, error: 'AI 解析服務未設定' });
      return;
    }

    try {
      const { caption } = req.body as { caption: string };
      const result = await this.importService.parseCaption(caption);
      res.status(200).json(result);
    } catch (error) {
      console.error('Error in parseCaption controller:', error);
      res.status(200).json({
        success: false,
        reason: 'gemini_unavailable',
        message: 'AI 服務暫時無法使用，請稍後再試或手動填寫',
      });
    }
  };

  // 外部圖片網址 → 伺服器抓取後跑既有驗證＋R2 上傳，回傳 R2 網址
  fetchImage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
      console.error('Error in fetchImage controller:', error);
      res.status(400).json({
        success: false,
        error: '圖片抓取失敗',
        reason: 'fetch_failed',
      });
    }
  };
}
