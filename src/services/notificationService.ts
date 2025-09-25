import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import { UserNotification, NotificationFilterParams, NotificationsResponse } from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';

export class NotificationService {
  private collection = hasFirebaseConfig && db ? db.collection('notifications') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  // 創建通知
  async createNotification(
    userId: string,
    type: UserNotification['type'],
    title: string,
    message: string,
    relatedId: string,
    relatedType: 'artist' | 'event'
  ): Promise<UserNotification> {
    this.checkFirebaseConfig();

    const notificationData = {
      userId,
      type,
      title,
      message,
      relatedId,
      relatedType,
      isRead: false,
      createdAt: Timestamp.now(),
    };

    const docRef = await withTimeoutAndRetry(() => this.collection.add(notificationData));

    return {
      id: docRef.id,
      ...notificationData,
    };
  }

  // 獲取用戶通知（支援篩選和分頁）
  async getUserNotifications(
    userId: string,
    filters: NotificationFilterParams = {}
  ): Promise<NotificationsResponse> {
    this.checkFirebaseConfig();

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100); // 預設20筆，最大100筆
    const skip = (page - 1) * limit;

    let query = this.collection.where('userId', '==', userId);

    // 已讀/未讀篩選
    if (filters.isRead !== undefined) {
      query = query.where('isRead', '==', filters.isRead);
    }

    // 通知類型篩選
    if (filters.type) {
      query = query.where('type', '==', filters.type);
    }

    // 按時間排序（最新在前）
    const snapshot = await withTimeoutAndRetry(() => query.orderBy('createdAt', 'desc').get());

    const allNotifications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as UserNotification[];

    // 分頁處理
    const notifications = allNotifications.slice(skip, skip + limit);
    const total = allNotifications.length;
    const totalPages = Math.ceil(total / limit);

    // 計算未讀數量
    const unreadCount = allNotifications.filter(n => !n.isRead).length;

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        unreadCount,
        totalCount: total,
      },
    };
  }

  // 標記通知為已讀
  async markAsRead(notificationId: string, userId: string): Promise<UserNotification> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(notificationId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('通知不存在');
    }

    const data = doc.data() as UserNotification;

    // 檢查是否為該用戶的通知
    if (data.userId !== userId) {
      throw new Error('權限不足');
    }

    await withTimeoutAndRetry(() =>
      docRef.update({
        isRead: true,
        updatedAt: Timestamp.now(),
      })
    );

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as UserNotification;
  }

  // 批量標記為已讀
  async markMultipleAsRead(notificationIds: string[], userId: string): Promise<void> {
    this.checkFirebaseConfig();

    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }

    const batch = db.batch();

    for (const id of notificationIds) {
      const docRef = this.collection.doc(id);
      const doc = await withTimeoutAndRetry(() => docRef.get());

      if (doc.exists) {
        const data = doc.data() as UserNotification;
        // 只處理屬於該用戶的通知
        if (data.userId === userId) {
          batch.update(docRef, {
            isRead: true,
            updatedAt: Timestamp.now(),
          });
        }
      }
    }

    await withTimeoutAndRetry(() => batch.commit());
  }

  // 刪除通知
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(notificationId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('通知不存在');
    }

    const data = doc.data() as UserNotification;

    // 檢查是否為該用戶的通知
    if (data.userId !== userId) {
      throw new Error('權限不足');
    }

    await withTimeoutAndRetry(() => docRef.delete());
  }

  // 獲取未讀通知數量
  async getUnreadCount(userId: string): Promise<number> {
    this.checkFirebaseConfig();
    const snapshot = await withTimeoutAndRetry(() =>
      this.collection.where('userId', '==', userId).where('isRead', '==', false).get()
    );

    return snapshot.size;
  }

  // 清理舊通知（可用於定期清理任務）
  async cleanupOldNotifications(daysToKeep: number = 30): Promise<void> {
    this.checkFirebaseConfig();
    const cutoffDate = Timestamp.fromDate(new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000));

    const snapshot = await withTimeoutAndRetry(() =>
      this.collection.where('createdAt', '<', cutoffDate).get()
    );

    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await withTimeoutAndRetry(() => batch.commit());
  }
}

// 通知輔助函數
export class NotificationHelper {
  private notificationService = new NotificationService();

  // 審核藝人通知
  async notifyArtistReview(
    userId: string,
    artistName: string,
    artistId: string,
    status: 'approved' | 'rejected' | 'exists',
    reason?: string
  ): Promise<void> {
    let title: string;
    let message: string;
    let type: UserNotification['type'];

    switch (status) {
      case 'approved':
        title = '藝人審核通過';
        message = `您投稿的藝人「${artistName}」已通過審核`;
        type = 'artist_approved';
        break;
      case 'rejected':
        title = '藝人審核未通過';
        message = `您投稿的藝人「${artistName}」審核未通過${reason ? `：${reason}` : ''}`;
        type = 'artist_rejected';
        break;
      case 'exists':
        title = '藝人已存在';
        message = `您投稿的藝人「${artistName}」在系統中已存在`;
        type = 'artist_exists';
        break;
    }

    await this.notificationService.createNotification(
      userId,
      type,
      title,
      message,
      artistId,
      'artist'
    );
  }

  // 審核活動通知
  async notifyEventReview(
    userId: string,
    eventTitle: string,
    eventId: string,
    status: 'approved' | 'rejected',
    reason?: string
  ): Promise<void> {
    let title: string;
    let message: string;
    let type: UserNotification['type'];

    switch (status) {
      case 'approved':
        title = '活動審核通過';
        message = `您投稿的活動「${eventTitle}」已通過審核`;
        type = 'event_approved';
        break;
      case 'rejected':
        title = '活動審核未通過';
        message = `您投稿的活動「${eventTitle}」審核未通過${reason ? `：${reason}` : ''}`;
        type = 'event_rejected';
        break;
    }

    await this.notificationService.createNotification(
      userId,
      type,
      title,
      message,
      eventId,
      'event'
    );
  }
}
