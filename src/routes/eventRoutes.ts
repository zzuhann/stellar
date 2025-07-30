import { Router } from 'express';
import { EventController } from '../controllers/eventController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const eventController = new EventController();

// 公開路由
router.get('/', eventController.getActiveEvents);
router.get('/search', eventController.searchEvents);
router.get('/:id', eventController.getEventById);

// 需要登入的路由
router.post('/', authenticateToken, eventController.createEvent);
router.delete('/:id', authenticateToken, eventController.deleteEvent);

// 管理員專用路由
router.get('/admin/pending', authenticateToken, requireAdmin, eventController.getPendingEvents);
router.patch('/:id/review', authenticateToken, requireAdmin, eventController.reviewEvent);
router.put('/:id/approve', authenticateToken, requireAdmin, eventController.approveEvent);
router.put('/:id/reject', authenticateToken, requireAdmin, eventController.rejectEvent);

export default router;
