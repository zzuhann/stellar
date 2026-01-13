import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const userController = new UserController();

// 所有路由都需要登入
router.use(authenticateToken);

// 用戶資料相關
router.get('/profile', userController.getUserProfile);
router.put('/profile', userController.updateUserProfile);

// 通知相關
router.get('/notifications', userController.getNotifications);
router.get('/notifications/unread-count', userController.getUnreadCount);
router.patch('/notifications/:id/read', userController.markNotificationAsRead);
router.patch('/notifications/read', userController.markMultipleAsRead);
router.delete('/notifications/:id', userController.deleteNotification);

// 收藏相關
router.get('/favorites', userController.getFavorites);
router.post('/favorites', userController.addFavorite);
router.get('/favorites/:eventId/check', userController.checkFavorite);
router.delete('/favorites/:eventId', userController.removeFavorite);

export default router;
