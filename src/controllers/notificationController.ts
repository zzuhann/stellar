import { Request, Response } from 'express';
import { webpush } from '../config/webpush';
import { db } from '../config/firebase';
import admin from 'firebase-admin';

export const subscribeNotification = async (req: Request, res: Response) => {
  try {
    const { userId, subscription } = req.body;

    if (!userId || !subscription) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, subscription',
      });
      return;
    }

    if (!db) {
      res.status(500).json({
        success: false,
        error: 'Database not available',
      });
      return;
    }

    await db
      .collection('notification_subscriptions')
      .doc(userId)
      .set({
        subscription,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        deviceInfo: {
          userAgent: req.headers['user-agent'] || '',
          platform: req.body.platform || 'unknown',
        },
      });

    res.json({
      success: true,
      message: '訂閱成功',
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

export const sendApprovalNotification = async (req: Request, res: Response) => {
  try {
    const { userId, type, submissionId, title, message } = req.body;

    if (!userId || !type) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, type',
      });
      return;
    }

    if (!db) {
      res.status(500).json({
        success: false,
        error: 'Database not available',
      });
      return;
    }

    const userDoc = await db.collection('notification_subscriptions').doc(userId).get();

    if (!userDoc.exists || !userDoc.data()?.isActive) {
      res.status(404).json({
        success: false,
        error: 'User not subscribed to notifications',
      });
      return;
    }

    const { subscription } = userDoc.data();

    const defaultTitle = '審核通過！';
    const defaultMessage = `你的${type === 'artist' ? '藝人' : '活動'}投稿已通過審核`;

    const payload = JSON.stringify({
      title: title || defaultTitle,
      body: message || defaultMessage,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: {
        type: 'approval',
        category: type,
        submissionId: submissionId || null,
        url: '/',
      },
    });

    await webpush.sendNotification(subscription, payload);

    await db.collection('notification_logs').add({
      userId,
      type: 'approval',
      category: type,
      submissionId: submissionId || null,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'sent',
    });

    res.json({
      success: true,
      message: '通知已發送',
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Send notification error:', error);

    if (db) {
      await db.collection('notification_logs').add({
        userId: req.body.userId,
        type: 'approval',
        category: req.body.type,
        submissionId: req.body.submissionId || null,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to send notification',
    });
  }
};

export const unsubscribeNotification = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!db) {
      res.status(500).json({
        success: false,
        error: 'Database not available',
      });
      return;
    }

    await db.collection('notification_subscriptions').doc(userId).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      message: '已取消訂閱',
    });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe',
    });
  }
};

export const getVapidKey = (req: Request, res: Response): void => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY,
  });
};
