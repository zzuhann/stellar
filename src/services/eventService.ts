import { db, hasFirebaseConfig } from '../config/firebase';
import { CoffeeEvent, CreateEventData } from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';

export class EventService {
  private collection = hasFirebaseConfig ? db.collection('coffeeEvents') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase not configured');
    }
  }

  async getActiveEvents(): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();

    // 暫時簡化查詢，等複合索引完成後再改回完整查詢
    const snapshot = await this.collection!.where('status', '==', 'approved')
      .where('isDeleted', '==', false)
      .get();

    // 在程式中過濾時間和排序
    const now = Date.now();
    const events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );

    return events
      .filter(event => event.datetime.end.toMillis() >= now)
      .sort((a, b) => a.datetime.start.toMillis() - b.datetime.start.toMillis());
  }

  async getPendingEvents(): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();
    const snapshot = await this.collection!.where('status', '==', 'pending')
      .where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );
  }

  async getEventById(eventId: string): Promise<CoffeeEvent | null> {
    this.checkFirebaseConfig();
    const doc = await this.collection!.doc(eventId).get();

    if (!doc.exists || doc.data()?.isDeleted) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as CoffeeEvent;
  }

  async createEvent(eventData: CreateEventData, userId: string): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();

    // 驗證藝人是否存在且已審核
    const artistDoc = await db.collection('artists').doc(eventData.artistId).get();
    if (!artistDoc.exists || artistDoc.data()?.status !== 'approved') {
      throw new Error('Invalid or unapproved artist');
    }

    const now = Timestamp.now();
    const newEvent = {
      artistId: eventData.artistId,
      title: eventData.title,
      description: eventData.description,
      location: eventData.location,
      datetime: {
        start: Timestamp.fromDate(eventData.datetime.start),
        end: Timestamp.fromDate(eventData.datetime.end),
      },
      socialMedia: eventData.socialMedia || {},
      images: [],
      supportProvided: eventData.supportProvided || false,
      requiresReservation: eventData.requiresReservation || false,
      onSiteReservation: eventData.onSiteReservation || false,
      amenities: eventData.amenities || [],
      status: 'pending' as const,
      isDeleted: false,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await this.collection!.add(newEvent);

    return {
      id: docRef.id,
      ...newEvent,
    };
  }

  async updateEventStatus(eventId: string, status: 'approved' | 'rejected'): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(eventId);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.isDeleted) {
      throw new Error('Event not found');
    }

    const updateData = {
      status,
      updatedAt: Timestamp.now(),
    };

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as CoffeeEvent;
  }

  async deleteEvent(eventId: string, userId: string, userRole: string): Promise<void> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(eventId);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.isDeleted) {
      throw new Error('Event not found');
    }

    const eventData = doc.data();

    // 檢查權限：管理員可以刪除任何活動，一般用戶只能刪除自己的活動
    if (userRole !== 'admin' && eventData?.createdBy !== userId) {
      throw new Error('Permission denied');
    }

    // 軟刪除
    await docRef.update({
      isDeleted: true,
      updatedAt: Timestamp.now(),
    });
  }

  async searchEvents(criteria: {
    query?: string;
    artistName?: string;
    location?: string;
  }): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();
    const now = Timestamp.now();
    const query = this.collection!.where('status', '==', 'approved')
      .where('isDeleted', '==', false)
      .where('datetime.end', '>=', now);

    // 基本的搜尋功能（Firestore 的搜尋功能有限）
    const snapshot = await query.get();
    let events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );

    // 客戶端過濾
    if (criteria.query) {
      const searchTerm = criteria.query.toLowerCase();
      events = events.filter(
        event =>
          event.title.toLowerCase().includes(searchTerm) ||
          event.description.toLowerCase().includes(searchTerm)
      );
    }

    if (criteria.location) {
      const locationTerm = criteria.location.toLowerCase();
      events = events.filter(event => event.location.address.toLowerCase().includes(locationTerm));
    }

    // 如果需要按藝人名稱搜尋，需要另外查詢藝人資料
    if (criteria.artistName) {
      const artistSnapshot = await db
        .collection('artists')
        .where('name', '>=', criteria.artistName)
        .where('name', '<=', criteria.artistName + '\uf8ff')
        .where('status', '==', 'approved')
        .get();

      const artistIds = artistSnapshot.docs.map(doc => doc.id);
      events = events.filter(event => artistIds.includes(event.artistId));
    }

    return events.sort((a, b) => a.datetime.start.toMillis() - b.datetime.start.toMillis());
  }

  // 自動清理過期活動的方法（用於 Cloud Function）
  async cleanupExpiredEvents(): Promise<void> {
    this.checkFirebaseConfig();
    const oneWeekAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    const expiredEvents = await this.collection!.where('datetime.end', '<', oneWeekAgo)
      .where('isDeleted', '==', false)
      .get();

    const batch = db.batch();

    expiredEvents.docs.forEach(doc => {
      batch.update(doc.ref, {
        isDeleted: true,
        updatedAt: Timestamp.now(),
      });
    });

    await batch.commit();
  }
}
