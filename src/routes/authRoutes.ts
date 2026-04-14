import { Router } from 'express';
import { AuthController } from '../controllers/authController';

const router = Router();
const authController = new AuthController();

// 發起 Threads OAuth（從 query string 驗證 token）
router.get('/threads', (req, res) => authController.initiateThreadsOAuth(req, res));

// Threads OAuth callback（不需登入，state 中有 userId）
router.get('/threads/callback', (req, res) => authController.handleThreadsCallback(req, res));

export default router;
