import { Router } from 'express';
import { EventController } from '../controllers/eventController';
import { authenticateToken, requireAdmin, optionalAuthenticate } from '../middleware/auth';
import { validateRequest, eventSchemas } from '../middleware/validation';

const router = Router();
const eventController = new EventController();

// 公開路由（使用 optionalAuthenticate 來支援 checkFavorite 參數）
router.get('/', optionalAuthenticate, (req, res) => void eventController.getActiveEvents(req, res));
router.get('/map-data', (req, res) => void eventController.getMapData(req, res));
router.get('/search', (req, res) => void eventController.searchEvents(req, res));

// 需要登入的路由 (必須在 /:id 之前)
router.get(
  '/me',
  authenticateToken,
  (req, res) => void eventController.getUserSubmissions(req, res)
);

// 公開路由 (動態參數路由放最後)
// 使用 optionalAuthenticate 來取得收藏狀態（如果已登入）
router.get('/:id', optionalAuthenticate, (req, res) => void eventController.getEventById(req, res));

// 其他需要登入的路由
router.post(
  '/',
  authenticateToken,
  validateRequest({ body: eventSchemas.create }),
  (req, res) => void eventController.createEvent(req, res)
);
router.put(
  '/:id',
  authenticateToken,
  validateRequest({ body: eventSchemas.update }),
  (req, res) => void eventController.updateEvent(req, res)
);
router.patch(
  '/:id/resubmit',
  authenticateToken,
  (req, res) => void eventController.resubmitEvent(req, res)
);
router.delete('/:id', authenticateToken, (req, res) => void eventController.deleteEvent(req, res));

// 管理員專用路由
router.get(
  '/admin/pending',
  authenticateToken,
  requireAdmin,
  (req, res) => void eventController.getPendingEvents(req, res)
);
router.patch(
  '/:id/review',
  authenticateToken,
  requireAdmin,
  (req, res) => void eventController.reviewEvent(req, res)
);
router.put(
  '/:id/approve',
  authenticateToken,
  requireAdmin,
  (req, res) => void eventController.approveEvent(req, res)
);
router.put(
  '/:id/reject',
  authenticateToken,
  requireAdmin,
  (req, res) => void eventController.rejectEvent(req, res)
);

export default router;
