import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ImageService } from '../services/imageService';

export class ImageController {
  private imageService: ImageService;

  constructor() {
    this.imageService = new ImageService();
  }

  // 上傳圖片
  uploadImage = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 檢查是否有上傳檔案
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: '未提供圖片檔案',
          code: 'VALIDATION_ERROR',
          field: 'file',
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
          code: 'IMAGE_UPLOAD_FAILED',
        });
      }
    } catch (error) {
      next(error);
    }
  };

  // 刪除圖片
  deleteImage = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { imageUrl } = req.body;

      // 驗證必填欄位
      if (!imageUrl) {
        res.status(400).json({
          success: false,
          error: '未提供圖片 URL',
          code: 'VALIDATION_ERROR',
          field: 'imageUrl',
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
          code: 'IMAGE_DELETE_FAILED',
        });
      }
    } catch (error) {
      next(error);
    }
  };

  // 檢查服務狀態
  getServiceStatus = (_req: AuthenticatedRequest, res: Response): void => {
    try {
      const status = this.imageService.getServiceStatus();
      res.json(status);
    } catch {
      res.status(500).json({
        available: false,
        message: 'Service check failed',
        code: 'SERVICE_UNAVAILABLE',
      });
    }
  };

  // R2 網路連線健康檢查（不建立任何檔案，供合成監控使用）
  checkR2Health = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    const result = await this.imageService.checkR2Health();
    if (result.reachable) {
      res.json({ reachable: true });
    } else {
      res.status(502).json({ reachable: false, error: result.error, code: 'R2_UNREACHABLE' });
    }
  };
}
