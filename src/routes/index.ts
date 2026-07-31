import { Router, Request, Response } from 'express';
import artistRoutes from './artistRoutes';
import eventRoutes from './eventRoutes';
import placesRoutes from './placesRoutes';
import imageRoutes from './imageRoutes';
import userRoutes from './userRoutes';
import cacheRoutes from './cacheRoutes';
import authRoutes from './authRoutes';
import contactRoutes from './contactRoutes';
import venueRoutes from './venueRoutes';
import adminRoutes from './adminRoutes';
import venueSubmissionRoutes from './venueSubmissionRoutes';
import importRoutes from './importRoutes';
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

// 聯絡表單（不需要 Firebase）
router.use('/contact', contactRoutes);

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
  router.use('/venues', venueRoutes);
  router.use('/venue-submissions', venueSubmissionRoutes);
  router.use('/admin', adminRoutes);
  // authenticateToken 依賴 Firestore 的 users collection 查角色，跟其他認證相關路由一樣
  // 只在 Firebase 可用時掛載
  router.use('/import', importRoutes);
} else {
  const firebaseUnavailable = (_req: Request, res: Response) =>
    res
      .status(503)
      .json({ error: 'Firebase 問題，請檢查環境變數. Please set up environment variables first.' });
  [
    '/artists',
    '/events',
    '/users',
    '/venues',
    '/venue-submissions',
    '/cache',
    '/auth',
    '/import',
  ].forEach(p => router.use(p, firebaseUnavailable));
}

export default router;
