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

// 我的投稿（分頁，各資源獨立統計）
router.get('/me/submissions/events', userController.getMySubmittedEvents);
router.get('/me/submissions/artists', userController.getMySubmittedArtists);

// 已認領活動
router.get('/me/claimed-events', userController.getMyClaimedEvents);

// 收藏相關
router.get('/favorites', userController.getFavorites);
router.post('/favorites', userController.addFavorite);
router.get('/favorites/:eventId/check', userController.checkFavorite);
router.delete('/favorites/:eventId', userController.removeFavorite);

export default router;
