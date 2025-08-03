import { db, hasFirebaseConfig } from '../config/firebase';
import {
  CoffeeEvent,
  CreateEventData,
  UpdateEventData,
  EventFilterParams,
  EventsResponse,
  MapDataParams,
  MapDataResponse,
  UserSubmissionsResponse,
} from '../models/types';
import { Timestamp, Query, CollectionReference, DocumentData } from 'firebase-admin/firestore';

export class EventService {
  private collection = hasFirebaseConfig && db ? db.collection('coffeeEvents') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase not configured');
    }
  }

  private parseDateTime(
    dateValue: Date | string | { _seconds: number; _nanoseconds: number }
  ): Timestamp {
    // 如果是 Firebase Timestamp 格式（包含 _seconds）
    if (dateValue && typeof dateValue === 'object' && '_seconds' in dateValue) {
      return Timestamp.fromMillis(
        dateValue._seconds * 1000 + Math.floor(dateValue._nanoseconds / 1000000)
      );
    }
    // 如果是 Date 物件或字串
    return Timestamp.fromDate(new Date(dateValue));
  }

  async getActiveEvents(): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();

    // 暫時簡化查詢，等複合索引完成後再改回完整查詢
    const snapshot = await this.collection!.where('status', '==', 'approved').get();

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

  async getEventsByStatus(status?: 'approved' | 'pending' | 'rejected'): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();

    // 簡化查詢策略：先用單一條件查詢，再在記憶體中篩選
    let snapshot;

    if (status) {
      // 用狀態查詢（有單一欄位索引）
      snapshot = await this.collection!.where('status', '==', status).get();
    } else {
      // 取得所有文件
      snapshot = await this.collection!.get();
    }

    let events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );
    // 新版 API 已移除 isDeleted 欄位

    // 如果是 approved 狀態，在記憶體中過濾未過期的活動
    if (status === 'approved') {
      const now = Date.now();
      events = events.filter(event => event.datetime.end.toMillis() >= now);
    }

    // 按建立時間排序（最新在前）
    return events.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  }

  // 新增：進階篩選和分頁功能
  async getEventsWithFilters(filters: EventFilterParams): Promise<EventsResponse> {
    this.checkFirebaseConfig();

    // 設定預設值
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100); // 最大限制100筆
    const skip = (page - 1) * limit;

    // 基礎查詢
    let query: Query<DocumentData> | CollectionReference<DocumentData> = this.collection!;

    // 藝人篩選：先取得所有資料再在記憶體中篩選（因為要搜尋 artists 陣列）
    // 移除此篩選條件，改為記憶體篩選

    // 創建者篩選
    if (filters.createdBy) {
      query = query.where('createdBy', '==', filters.createdBy);
    }

    const snapshot = await query.get();

    let events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );

    // 審核狀態篩選
    if (filters.status && filters.status !== 'all') {
      events = events.filter(event => event.status === filters.status);
    }

    // 搜尋篩選
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      events = events.filter(
        event =>
          event.title.toLowerCase().includes(searchTerm) ||
          event.artists.some(artist => artist.name.toLowerCase().includes(searchTerm)) ||
          (event.description && event.description.toLowerCase().includes(searchTerm)) ||
          event.location.address.toLowerCase().includes(searchTerm)
      );
    }

    // 地區篩選
    if (filters.region) {
      const regionTerm = filters.region.toLowerCase();
      events = events.filter(event => event.location.address.toLowerCase().includes(regionTerm));
    }

    // 藝人篩選（在記憶體中進行）
    if (filters.artistId) {
      events = events.filter(event => event.artists.some(artist => artist.id === filters.artistId));
    }

    // 重新計算總數（因為加了藝人篩選）
    const filteredTotal = events.length;
    const filteredTotalPages = Math.ceil(filteredTotal / limit);

    // 分頁處理
    const finalPaginatedEvents = events
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()) // 按時間排序
      .slice(skip, skip + limit);

    return {
      events: finalPaginatedEvents,
      pagination: {
        page,
        limit,
        total: filteredTotal,
        totalPages: filteredTotalPages,
      },
      filters: {
        search: filters.search,
        artistId: filters.artistId,
        status: filters.status,
        region: filters.region,
      },
    };
  }

  // 新增：地圖資料 API
  async getMapData(params: MapDataParams): Promise<MapDataResponse> {
    this.checkFirebaseConfig();

    const status = params.status || 'active';

    // 建立查詢（取得所有已審核的活動，再在記憶體中篩選）
    const query = this.collection!.where('status', '==', 'approved');

    const snapshot = await query.get();

    let events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );

    // 已在查詢中篩選 approved 狀態

    const now = Date.now();

    // 只顯示未結束的活動（進行中或即將開始）
    events = events.filter(event => {
      const endTime = event.datetime.end.toMillis();
      return endTime >= now; // 結束時間還沒到
    });

    // 如果有指定 status 參數，額外篩選
    if (status !== 'all') {
      events = events.filter(event => {
        const startTime = event.datetime.start.toMillis();
        const endTime = event.datetime.end.toMillis();

        switch (status) {
          case 'active':
            return startTime <= now && endTime >= now;
          case 'upcoming':
            return startTime > now;
          default:
            return true;
        }
      });
    }

    // 藝人篩選（在記憶體中進行）
    if (params.artistId) {
      events = events.filter(event => event.artists.some(artist => artist.id === params.artistId));
    }

    // 搜尋篩選
    if (params.search) {
      const searchTerm = params.search.toLowerCase();
      events = events.filter(
        event =>
          event.title.toLowerCase().includes(searchTerm) ||
          event.artists.some(artist => artist.name.toLowerCase().includes(searchTerm)) ||
          (event.description && event.description.toLowerCase().includes(searchTerm)) ||
          event.location.address.toLowerCase().includes(searchTerm)
      );
    }

    // 地區篩選
    if (params.region) {
      const regionTerm = params.region.toLowerCase();
      events = events.filter(event => event.location.address.toLowerCase().includes(regionTerm));
    }

    // 地圖邊界篩選（如果提供）
    if (params.bounds) {
      const [lat1, lng1, lat2, lng2] = params.bounds.split(',').map(Number);
      const minLat = Math.min(lat1, lat2);
      const maxLat = Math.max(lat1, lat2);
      const minLng = Math.min(lng1, lng2);
      const maxLng = Math.max(lng1, lng2);

      events = events.filter(event => {
        const lat = event.location.coordinates.lat;
        const lng = event.location.coordinates.lng;
        return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
      });
    }

    // 轉換為地圖格式
    const mapEvents = events.map(event => {
      return {
        id: event.id,
        title: event.title,
        mainImage: event.mainImage,
        location: event.location, // 完整的 location 物件
        datetime: {
          start: event.datetime.start.toDate().toISOString(),
          end: event.datetime.end.toDate().toISOString(),
        },
      };
    });

    return {
      events: mapEvents,
      total: mapEvents.length,
    };
  }

  async getEventById(eventId: string): Promise<CoffeeEvent | null> {
    this.checkFirebaseConfig();
    const doc = await this.collection!.doc(eventId).get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as CoffeeEvent;
  }

  async createEvent(eventData: CreateEventData, userId: string): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();

    if (!db) {
      throw new Error('Firebase not configured');
    }

    // 驗證所有藝人是否存在且已審核
    const artists: Array<{ id: string; name: string; profileImage?: string }> = [];

    for (const artistId of eventData.artistIds) {
      const artistDoc = await db.collection('artists').doc(artistId).get();
      if (!artistDoc.exists || artistDoc.data()?.status !== 'approved') {
        throw new Error(`Invalid or unapproved artist: ${artistId}`);
      }

      const artistData = artistDoc.data();
      artists.push({
        id: artistId,
        name: artistData?.stageName || '',
        profileImage: artistData?.profileImage || undefined,
      });
    }

    const now = Timestamp.now();
    const newEvent = {
      artists: artists,
      title: eventData.title,
      description: eventData.description,
      location: eventData.location,
      datetime: {
        start: this.parseDateTime(eventData.datetime.start),
        end: this.parseDateTime(eventData.datetime.end),
      },
      socialMedia: eventData.socialMedia || {},
      mainImage: eventData.mainImage,
      detailImage: eventData.detailImage,
      status: 'pending' as const,
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

  async updateEvent(
    eventId: string,
    updateData: UpdateEventData,
    userId: string,
    userRole: string
  ): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(eventId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Event not found');
    }

    const eventData = doc.data();

    // 檢查權限：管理員可以編輯任何活動，一般用戶只能編輯自己的活動
    if (userRole !== 'admin' && eventData?.createdBy !== userId) {
      throw new Error('Permission denied');
    }

    // 準備更新資料
    const updates: Record<string, unknown> = {
      updatedAt: Timestamp.now(),
    };

    // 只更新提供的欄位
    if (updateData.title !== undefined) updates.title = updateData.title;
    if (updateData.description !== undefined) updates.description = updateData.description;
    if (updateData.location !== undefined) updates.location = updateData.location;
    if (updateData.socialMedia !== undefined) updates.socialMedia = updateData.socialMedia;
    if (updateData.mainImage !== undefined) updates.mainImage = updateData.mainImage;
    if (updateData.detailImage !== undefined) updates.detailImage = updateData.detailImage;

    // 處理時間資料
    if (updateData.datetime) {
      updates.datetime = {
        start: this.parseDateTime(updateData.datetime.start),
        end: this.parseDateTime(updateData.datetime.end),
      };
    }

    await docRef.update(updates);

    const updatedDoc = await docRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as CoffeeEvent;
  }

  async updateEventStatus(eventId: string, status: 'approved' | 'rejected'): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(eventId);
    const doc = await docRef.get();

    if (!doc.exists) {
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

    if (!doc.exists) {
      throw new Error('Event not found');
    }

    const eventData = doc.data();

    // 檢查權限：管理員可以刪除任何活動，一般用戶只能刪除自己的活動
    if (userRole !== 'admin' && eventData?.createdBy !== userId) {
      throw new Error('Permission denied');
    }

    // 直接刪除文件（不再使用軟刪除）
    await docRef.delete();
  }

  async searchEvents(criteria: {
    query?: string;
    artistName?: string;
    location?: string;
  }): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();
    const now = Timestamp.now();
    const query = this.collection!.where('status', '==', 'approved');

    // 基本的搜尋功能（Firestore 的搜尋功能有限）
    const snapshot = await query.get();
    let events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );

    // 過濾未過期的活動
    events = events.filter(event => event.datetime.end.toMillis() >= now.toMillis());

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

    // 藝人名稱搜尋（在新的 artists 陣列中搜尋）
    if (criteria.artistName) {
      const artistNameTerm = criteria.artistName.toLowerCase();
      events = events.filter(event =>
        event.artists.some(artist => artist.name.toLowerCase().includes(artistNameTerm))
      );
    }

    return events.sort((a, b) => a.datetime.start.toMillis() - b.datetime.start.toMillis());
  }

  // 獲取用戶的所有投稿（藝人和活動）
  async getUserSubmissions(userId: string): Promise<UserSubmissionsResponse> {
    this.checkFirebaseConfig();

    if (!db) {
      throw new Error('Firebase not configured');
    }

    // 獲取用戶的藝人投稿（簡化查詢避免索引問題）
    const artistsSnapshot = await db.collection('artists').where('createdBy', '==', userId).get();

    const artists = artistsSnapshot.docs
      .map(
        doc =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as import('../models/types').Artist
      )
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()); // 在記憶體中排序

    // 獲取用戶的活動投稿（簡化查詢避免索引問題）
    const eventsSnapshot = await this.collection!.where('createdBy', '==', userId).get();

    const events = eventsSnapshot.docs
      .map(
        doc =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as CoffeeEvent
      )
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()); // 在記憶體中排序

    // 計算統計資訊
    const pendingArtists = artists.filter(a => a.status === 'pending').length;
    const approvedArtists = artists.filter(a => a.status === 'approved').length;
    const pendingEvents = events.filter(e => e.status === 'pending').length;
    const approvedEvents = events.filter(e => e.status === 'approved').length;

    return {
      artists,
      events,
      summary: {
        totalArtists: artists.length,
        totalEvents: events.length,
        pendingArtists,
        pendingEvents,
        approvedArtists,
        approvedEvents,
      },
    };
  }

  // 自動清理過期活動的方法（用於 Cloud Function）
  async cleanupExpiredEvents(): Promise<void> {
    this.checkFirebaseConfig();
    const oneWeekAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    const expiredEvents = await this.collection!.where('datetime.end', '<', oneWeekAgo).get();

    if (!db) {
      throw new Error('Firebase not configured');
    }
    const batch = db.batch();

    expiredEvents.docs.forEach(doc => {
      // 直接刪除過期活動（不再使用軟刪除）
      batch.delete(doc.ref);
    });

    await batch.commit();
  }
}
