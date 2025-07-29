import { Router } from 'express';
import artistRoutes from './artistRoutes';
import eventRoutes from './eventRoutes';
import { hasFirebaseConfig } from '../config/firebase';

const router = Router();

// 健康檢查端點（不需要 Firebase）
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebase: {
      configured: hasFirebaseConfig,
      message: hasFirebaseConfig ? 'Firebase ready' : 'Firebase not configured',
    },
  });
});

// 簡單測試端點
router.get('/test', async (req, res) => {
  if (!hasFirebaseConfig) {
    res.status(503).json({ error: 'Firebase not configured' });
    return;
  }

  try {
    const { db } = await import('../config/firebase');

    // 測試 1：讀取所有 artists（不用複合查詢）
    const allArtists = await db.collection('artists').limit(5).get();
    const artistsData = allArtists.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 測試 2：單純 status 查詢
    const approvedArtists = await db.collection('artists').where('status', '==', 'approved').get();
    const approvedData = approvedArtists.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.json({
      success: true,
      allArtists: artistsData,
      approvedArtists: approvedData,
      counts: {
        total: allArtists.size,
        approved: approvedArtists.size,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Firebase test failed',
      details: error.message,
    });
  }
});

// Firebase 配置完成，啟用完整路由
if (hasFirebaseConfig) {
  router.use('/artists', artistRoutes);
  router.use('/events', eventRoutes);
} else {
  // Firebase 未配置時的提示端點
  router.use('/artists', (req, res) => {
    res
      .status(503)
      .json({ error: 'Firebase not configured. Please set up environment variables first.' });
  });
  router.use('/events', (req, res) => {
    res
      .status(503)
      .json({ error: 'Firebase not configured. Please set up environment variables first.' });
  });
}

export default router;
