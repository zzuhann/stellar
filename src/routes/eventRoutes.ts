import { Router } from 'express';
import { EventController } from '../controllers/eventController';
import { authenticateToken, requireAdmin, optionalAuthenticate } from '../middleware/auth';
import { validateRequest, eventSchemas } from '../middleware/validation';

const router = Router();
const eventController = new EventController();

// 公開路由（使用 optionalAuthenticate 來支援 checkFavorite 參數）
router.get('/', optionalAuthenticate, (req, res) => eventController.getActiveEvents(req, res));
router.get('/map-data', (req, res) => eventController.getMapData(req, res));
router.get('/search', (req, res) => eventController.searchEvents(req, res));
router.get('/trending', (req, res) => eventController.getTrendingEvents(req, res));

// 需要登入的路由 (必須在 /:id 之前)
// Deprecated: 改用 GET /users/me/submissions/events 與 /users/me/submissions/artists
router.get('/me', authenticateToken, (_req, res) => {
  res.set('Deprecation', 'true');
  res.status(410).json({
    error:
      'This endpoint is removed. Use GET /users/me/submissions/events and GET /users/me/submissions/artists',
  });
});

// 公開路由 (動態參數路由放最後)
// 使用 optionalAuthenticate 來取得收藏狀態（如果已登入）
router.get('/:id', optionalAuthenticate, (req, res) => eventController.getEventById(req, res));
router.post('/:id/view', (req, res) => eventController.recordView(req, res));

// 其他需要登入的路由
router.post('/', authenticateToken, validateRequest({ body: eventSchemas.create }), (req, res) =>
  eventController.createEvent(req, res)
);
router.put('/:id', authenticateToken, validateRequest({ body: eventSchemas.update }), (req, res) =>
  eventController.updateEvent(req, res)
);
router.patch('/:id/resubmit', authenticateToken, (req, res) =>
  eventController.resubmitEvent(req, res)
);
router.delete('/:id', authenticateToken, (req, res) => eventController.deleteEvent(req, res));

// 管理員專用路由
router.get('/admin/pending', authenticateToken, requireAdmin, (req, res) =>
  eventController.getPendingEvents(req, res)
);
router.patch('/:id/review', authenticateToken, requireAdmin, (req, res) =>
  eventController.reviewEvent(req, res)
);
router.put('/:id/approve', authenticateToken, requireAdmin, (req, res) =>
  eventController.approveEvent(req, res)
);
router.put('/:id/reject', authenticateToken, requireAdmin, (req, res) =>
  eventController.rejectEvent(req, res)
);
router.post('/batch-review', authenticateToken, requireAdmin, (req, res) =>
  eventController.batchReviewEvents(req, res)
);

export default router;
