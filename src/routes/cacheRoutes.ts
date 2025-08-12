import { Router, Request, Response } from 'express';
import { cache } from '../utils/cache';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// 只有管理員可以查看快取統計
router.get('/stats', authenticateToken, requireAdmin, (req: Request, res: Response) => {
  const stats = cache.getStats();
  res.json(stats);
});

// 清除所有快取（僅供測試用）
router.delete('/clear', authenticateToken, requireAdmin, (req: Request, res: Response) => {
  cache.clear();
  res.json({ message: 'Cache cleared successfully' });
});

export default router;
