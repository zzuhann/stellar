import { Router } from 'express';
import artistRoutes from './artistRoutes';
import eventRoutes from './eventRoutes';
import placesRoutes from './placesRoutes';
import imageRoutes from './imageRoutes';
import userRoutes from './userRoutes';
import cacheRoutes from './cacheRoutes';
import authRoutes from './authRoutes';
import { hasFirebaseConfig } from '../config/firebase';
import { hasR2Config } from '../config/r2-client';

const router = Router();

// 健康檢查端點（不需要 Firebase）
router.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebase: {
      configured: hasFirebaseConfig,
      message: hasFirebaseConfig ? 'Firebase ready' : 'Firebase 問題，請檢查環境變數',
    },
    r2: {
      configured: hasR2Config,
      message: hasR2Config ? 'R2 ready' : 'R2 not configured',
    },
  });
});

// Google Places API 路由（不需要 Firebase）
router.use('/places', placesRoutes);

// R2 圖片上傳路由（不需要 Firebase）
router.use('/images', imageRoutes);

// Firebase 配置完成，啟用完整路由
if (hasFirebaseConfig) {
  router.use('/artists', artistRoutes);
  router.use('/events', eventRoutes);
  router.use('/users', userRoutes);
  router.use('/cache', cacheRoutes);
  router.use('/auth', authRoutes);
} else {
  // Firebase 未配置時的提示端點
  router.use('/artists', (_req, res) => {
    res
      .status(503)
      .json({ error: 'Firebase 問題，請檢查環境變數. Please set up environment variables first.' });
  });
  router.use('/events', (_req, res) => {
    res
      .status(503)
      .json({ error: 'Firebase 問題，請檢查環境變數. Please set up environment variables first.' });
  });
  router.use('/users', (_req, res) => {
    res
      .status(503)
      .json({ error: 'Firebase 問題，請檢查環境變數. Please set up environment variables first.' });
  });
}

export default router;
