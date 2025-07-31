import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ImageService } from '../services/imageService';

export class ImageController {
  private imageService: ImageService;

  constructor() {
    this.imageService = new ImageService();
  }

  // 上傳圖片
  uploadImage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // 檢查是否有上傳檔案
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: '未提供圖片檔案',
        });
        return;
      }

      // 上傳圖片
      const result = await this.imageService.uploadImage(req.file);

      if (result.success) {
        res.json({
          success: true,
          imageUrl: result.imageUrl,
          filename: result.filename,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('Error in uploadImage controller:', error);
      if (error instanceof Error && error.message === 'R2 not configured') {
        res.status(503).json({
          success: false,
          error: '圖片上傳服務未設定',
        });
      } else {
        res.status(500).json({
          success: false,
          error: '上傳失敗',
        });
      }
    }
  };

  // 刪除圖片
  deleteImage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { imageUrl } = req.body;

      // 驗證必填欄位
      if (!imageUrl) {
        res.status(400).json({
          success: false,
          error: '未提供圖片 URL',
        });
        return;
      }

      // 刪除圖片
      const result = await this.imageService.deleteImage(imageUrl);

      if (result.success) {
        res.json({
          success: true,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('Error in deleteImage controller:', error);
      if (error instanceof Error && error.message === 'R2 not configured') {
        res.status(503).json({
          success: false,
          error: '圖片刪除服務未設定',
        });
      } else {
        res.status(500).json({
          success: false,
          error: '刪除失敗',
        });
      }
    }
  };

  // 檢查服務狀態
  getServiceStatus = (req: AuthenticatedRequest, res: Response): void => {
    try {
      const status = this.imageService.getServiceStatus();
      res.json(status);
    } catch {
      res.status(500).json({
        available: false,
        message: 'Service check failed',
      });
    }
  };
}
