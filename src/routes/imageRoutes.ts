import { Router } from 'express';
import { ImageController } from '../controllers/imageController';
import { authenticateToken } from '../middleware/auth';
import { uploadSingle } from '../middleware/upload';

const router = Router();
const imageController = new ImageController();

// 服務狀態檢查（公開路由）
router.get('/status', (req, res) => imageController.getServiceStatus(req, res));

// 需要登入的路由
router.post(
  '/upload',
  authenticateToken,
  uploadSingle,
  (req, res) => imageController.uploadImage(req, res)
);
router.delete(
  '/delete',
  authenticateToken,
  (req, res) => imageController.deleteImage(req, res)
);

export default router;
