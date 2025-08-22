import { db, hasFirebaseConfig } from '../config/firebase';
import { withTimeoutAndRetry } from '../utils/firestoreTimeout';
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
import { NotificationHelper } from './notificationService';
import { Timestamp, Query, CollectionReference, DocumentData } from 'firebase-admin/firestore';
import { cache } from '../utils/cache';

export class EventService {
  private collection = hasFirebaseConfig && db ? db.collection('coffeeEvents') : null;
  private notificationHelper = new NotificationHelper();

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase 問題，請檢查環境變數');
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
    if (dateValue instanceof Date) {
      return Timestamp.fromDate(dateValue);
    }
    // 如果是字串
    if (typeof dateValue === 'string') {
      return Timestamp.fromDate(new Date(dateValue));
    }
    // 如果是 number
    if (typeof dateValue === 'number') {
      return Timestamp.fromMillis(dateValue);
    }
    throw new Error('Invalid date value');
  }

  // 根據 zoom 級別計算緯度範圍（度數）
  private getLatitudeDeltaFromZoom(zoom: number): number {
    // 基於 Web Mercator 投影的近似計算
    // zoom 0: ~180 度, zoom 10: ~0.35 度, zoom 15: ~0.01 度
    return 360 / Math.pow(2, zoom + 1);
  }

  // 根據 zoom 級別和緯度計算經度範圍（度數）
  private getLongitudeDeltaFromZoom(zoom: number, latitude: number): number {
    const latitudeDelta = this.getLatitudeDeltaFromZoom(zoom);
    // 在不同緯度，經度的度數代表的實際距離不同
    // 使用 cos(latitude) 進行修正
    const latRad = (latitude * Math.PI) / 180;
    return latitudeDelta / Math.cos(latRad);
  }

  async getActiveEvents(): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();

    const cacheKey = 'events:active';
    const cachedResult = cache.get<CoffeeEvent[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 使用複合索引按開始時間排序
    const snapshot = await withTimeoutAndRetry(() =>
      this.collection.where('status', '==', 'approved').orderBy('datetime.start', 'asc').get()
    );

    // 只需過濾未結束的活動（已按開始時間排序）
    const now = Date.now();
    const events = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as CoffeeEvent
    );

    const activeEvents = events.filter(event => event.datetime.end.toMillis() >= now);

    // 設定 5 分鐘快取
    cache.set(cacheKey, activeEvents, 5);

    return activeEvents;
  }

  async getPendingEvents(): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();
    const snapshot = await withTimeoutAndRetry(() =>
      this.collection.where('status', '==', 'pending').orderBy('createdAt', 'desc').get()
    );

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

    const cacheKey = `events:status:${status || 'all'}`;
    let ttl = 5; // 預設 5 分鐘

    if (status === 'rejected') ttl = 10; // rejected: 10分鐘
    if (status === 'pending') ttl = 1; // pending: 1分鐘

    const cachedResult = cache.get<CoffeeEvent[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 簡化查詢策略：先用單一條件查詢，再在記憶體中篩選
    let snapshot;

    if (status) {
      // 用狀態查詢（有單一欄位索引）
      snapshot = await withTimeoutAndRetry(() =>
        this.collection.where('status', '==', status).get()
      );
    } else {
      // 取得所有文件
      snapshot = await withTimeoutAndRetry(() => this.collection.get());
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
    const result = events.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

    // 設定快取
    cache.set(cacheKey, result, ttl);

    return result;
  }

  // 新增：進階篩選和分頁功能
  async getEventsWithFilters(filters: EventFilterParams): Promise<EventsResponse> {
    this.checkFirebaseConfig();

    const cacheKey = `events:filters:${JSON.stringify(filters)}`;
    const cachedResult = cache.get<EventsResponse>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 設定預設值
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100); // 最大限制100筆
    const skip = (page - 1) * limit;

    // 基礎查詢
    let query: Query<DocumentData> | CollectionReference<DocumentData> = this.collection;

    // 藝人篩選：先取得所有資料再在記憶體中篩選（因為要搜尋 artists 陣列）
    // 移除此篩選條件，改為記憶體篩選

    // 創建者篩選
    if (filters.createdBy) {
      query = query.where('createdBy', '==', filters.createdBy);
    }

    const snapshot = await withTimeoutAndRetry(() => query.get());

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

    // 排序處理
    const sortedEvents = this.sortEvents(events, filters.sortBy, filters.sortOrder);

    // 分頁處理
    const finalPaginatedEvents = sortedEvents.slice(skip, skip + limit);

    const result = {
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

    // 設定 3 分鐘快取
    cache.set(cacheKey, result, 3);

    return result;
  }

  // 新增：地圖資料 API
  async getMapData(params: MapDataParams): Promise<MapDataResponse> {
    this.checkFirebaseConfig();

    const status = params.status || 'active';
    const cacheKey = `map-data:${status}:${JSON.stringify(params)}`;

    const cachedResult = cache.get<MapDataResponse>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 建立查詢（取得所有已審核的活動，再在記憶體中篩選）
    const query = this.collection.where('status', '==', 'approved');

    const snapshot = await withTimeoutAndRetry(() => query.get());

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

    // 地圖視窗篩選
    let viewBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null =
      null;

    // 優先使用 bounds 參數
    if (params.bounds) {
      const [lat1, lng1, lat2, lng2] = params.bounds.split(',').map(Number);
      viewBounds = {
        minLat: Math.min(lat1, lat2),
        maxLat: Math.max(lat1, lat2),
        minLng: Math.min(lng1, lng2),
        maxLng: Math.max(lng1, lng2),
      };
    }
    // 如果沒有 bounds 但有 center + zoom，計算視窗邊界
    else if (params.center && params.zoom !== undefined) {
      const [centerLat, centerLng] = params.center.split(',').map(Number);

      // 根據 zoom 級別計算視窗大小（度數）
      // zoom 越高，視窗越小
      const latDelta = this.getLatitudeDeltaFromZoom(params.zoom);
      const lngDelta = this.getLongitudeDeltaFromZoom(params.zoom, centerLat);

      viewBounds = {
        minLat: centerLat - latDelta / 2,
        maxLat: centerLat + latDelta / 2,
        minLng: centerLng - lngDelta / 2,
        maxLng: centerLng + lngDelta / 2,
      };
    }

    // 套用視窗篩選
    if (viewBounds) {
      events = events.filter(event => {
        // 檢查座標是否存在且有效
        if (!event.location?.coordinates?.lat || !event.location?.coordinates?.lng) {
          console.warn(`Event ${event.id} missing coordinates:`, event.location);
          return false; // 排除缺少座標的活動
        }

        const lat = event.location.coordinates.lat;
        const lng = event.location.coordinates.lng;
        return (
          lat >= viewBounds.minLat &&
          lat <= viewBounds.maxLat &&
          lng >= viewBounds.minLng &&
          lng <= viewBounds.maxLng
        );
      });
    }

    // 轉換為地圖格式
    const mapEvents = events
      .filter(event => {
        // 確保活動有完整的座標資料
        return event.location?.coordinates?.lat && event.location?.coordinates?.lng;
      })
      .map(event => {
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

    const result = {
      events: mapEvents,
      total: mapEvents.length,
    };

    // 設定 10 分鐘快取
    cache.set(cacheKey, result, 10);

    return result;
  }

  async getEventById(eventId: string): Promise<CoffeeEvent | null> {
    this.checkFirebaseConfig();

    const cacheKey = `event:${eventId}`;
    const cachedResult = cache.get<CoffeeEvent | null>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const doc = await withTimeoutAndRetry(() => this.collection.doc(eventId).get());

    if (!doc.exists) {
      // 也要快取 null 結果，避免重複查詢不存在的資料
      cache.set(cacheKey, null, 2);
      return null;
    }

    const event = {
      id: doc.id,
      ...doc.data(),
    } as CoffeeEvent;

    // 設定 2 分鐘快取
    cache.set(cacheKey, event, 2);

    return event;
  }

  async createEvent(eventData: CreateEventData, userId: string): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();

    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }

    // 驗證所有藝人是否存在且已審核
    const artists: Array<{ id: string; name: string; profileImage?: string }> = [];

    for (const artistId of eventData.artistIds) {
      const artistDoc = await withTimeoutAndRetry(() =>
        db.collection('artists').doc(artistId).get()
      );
      if (!artistDoc.exists || artistDoc.data()?.status !== 'approved') {
        throw new Error(`此偶像不存在或未通過審核`);
      }

      const artistData = artistDoc.data();
      artists.push({
        id: artistId,
        name: artistData?.stageName || '',
        profileImage: artistData?.profileImage || undefined,
      });
    }

    // 驗證座標資料
    if (!eventData.location?.coordinates?.lat || !eventData.location?.coordinates?.lng) {
      throw new Error('活動地點必須包含有效的座標資料');
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
      ...(eventData.mainImage && { mainImage: eventData.mainImage }),
      detailImage: eventData.detailImage || [],
      status: 'pending' as const,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await withTimeoutAndRetry(() => this.collection.add(newEvent));

    // 清除相關快取（新增事件會影響藝人的活動統計）
    cache.clearPattern('events:');
    cache.clearPattern('map-data:');

    // 清除相關 artists 的 eventCount 快取
    eventData.artistIds.forEach((artistId: string) => {
      cache.delete(`artist:${artistId}:eventCount`);
    });

    // 清除 artists 統計快取（因為新增事件會影響藝人的活動數量）
    cache.clearPattern('artists:stats:');

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
    const docRef = this.collection.doc(eventId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('活動不存在');
    }

    const eventData = doc.data();

    // 檢查權限：管理員可以編輯任何活動，一般用戶只能編輯自己的活動
    if (userRole !== 'admin' && eventData?.createdBy !== userId) {
      throw new Error('權限不足');
    }

    // 準備更新資料
    const updates: Record<string, unknown> = {
      updatedAt: Timestamp.now(),
    };

    // 只更新提供的欄位
    if (updateData.title !== undefined) updates.title = updateData.title;
    if (updateData.description !== undefined) updates.description = updateData.description;
    if (updateData.location !== undefined) {
      // 驗證座標資料
      if (!updateData.location?.coordinates?.lat || !updateData.location?.coordinates?.lng) {
        throw new Error('活動地點必須包含有效的座標資料');
      }
      updates.location = updateData.location;
    }
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

    await withTimeoutAndRetry(() => docRef.update(updates));

    // 清除相關快取
    cache.clearPattern('events:');
    cache.clearPattern('map-data:');
    cache.delete(`event:${eventId}`);

    // 清除相關藝人的統計快取（編輯事件可能會影響藝人的活動統計）
    if (eventData?.artists && Array.isArray(eventData.artists)) {
      eventData.artists.forEach((artist: { id: string }) => {
        cache.delete(`artist:${artist.id}:eventCount`);
      });
      // 清除統計快取
      cache.clearPattern('artists:stats:');
    }

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as CoffeeEvent;
  }

  async updateEventStatus(
    eventId: string,
    status: 'approved' | 'rejected',
    reason?: string
  ): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(eventId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('活動不存在');
    }

    const existingData = doc.data() as CoffeeEvent;

    const updateData: Record<string, unknown> = {
      status,
      updatedAt: Timestamp.now(),
    };

    // 如果是 rejected 且有提供 reason，則加入 rejectedReason
    if (status === 'rejected' && reason) {
      updateData.rejectedReason = reason;
    }
    // 如果是 approved，清除之前的 rejectedReason
    else if (status === 'approved') {
      updateData.rejectedReason = null;
    }

    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 更新相關 artists 的 activeEventIds
    if (existingData.artists && Array.isArray(existingData.artists)) {
      await this.updateArtistsActiveEventIds(
        existingData.artists.map((a: { id: string }) => a.id),
        eventId,
        status
      );
    }

    // 清除相關快取
    cache.clearPattern('events:');
    cache.clearPattern('map-data:');
    cache.delete(`event:${eventId}`);

    // 清除相關 artists 的 eventCount 快取
    if (existingData.artists && Array.isArray(existingData.artists)) {
      existingData.artists.forEach((artist: { id: string }) => {
        cache.delete(`artist:${artist.id}:eventCount`);
      });
    }

    // 清除 artists 統計快取（因為 coffeeEventCount 會改變）
    // 這裡需要清除統計快取，因為事件狀態改變會影響藝人的活動數量
    cache.clearPattern('artists:stats:');

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    const updatedEvent = {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as CoffeeEvent;

    // TODO: 發送通知給用戶 (暫時移除)
    // try {
    //   await this.notificationHelper.notifyEventReview(
    //     existingData.createdBy,
    //     existingData.title,
    //     eventId,
    //     status,
    //     reason
    //   );
    // } catch (notificationError) {
    //   console.error('Failed to send notification:', notificationError);
    //   // 不拋出錯誤，因為主要操作已成功
    // }

    return updatedEvent;
  }

  // 重新送審功能
  async resubmitEvent(eventId: string, userId: string): Promise<CoffeeEvent> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(eventId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('活動不存在');
    }

    const existingData = doc.data() as CoffeeEvent;

    // 檢查權限：只有創建者可以重新送審
    if (existingData.createdBy !== userId) {
      throw new Error('權限不足: 只能重新送審自己的投稿');
    }

    // 只有 rejected 狀態可以重新送審
    if (existingData.status !== 'rejected') {
      throw new Error('只能重新送審已拒絕的活動');
    }

    const updateData = {
      status: 'pending' as const,
      rejectedReason: null, // 清除拒絕原因
      updatedAt: Timestamp.now(),
    };

    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 更新相關 artists 的 activeEventIds
    if (existingData.artists && Array.isArray(existingData.artists)) {
      await this.updateArtistsActiveEventIds(
        existingData.artists.map((a: { id: string }) => a.id),
        eventId,
        'rejected'
      );
    }

    // 清除相關快取
    cache.clearPattern('events:');
    cache.clearPattern('map-data:');

    // 清除相關 artists 的 eventCount 快取
    if (existingData.artists && Array.isArray(existingData.artists)) {
      existingData.artists.forEach((artist: { id: string }) => {
        cache.delete(`artist:${artist.id}:eventCount`);
      });
    }

    // 注意：重新送審活動不會影響已審核活動的統計，所以不需要清除統計快取

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as CoffeeEvent;
  }

  // 更新 artists 的 activeEventIds
  private async updateArtistsActiveEventIds(
    artistIds: string[],
    eventId: string,
    status: 'approved' | 'rejected'
  ): Promise<void> {
    if (!db) return;

    try {
      const batch = db.batch();

      for (const artistId of artistIds) {
        const artistRef = db.collection('artists').doc(artistId);
        const artistDoc = await withTimeoutAndRetry(() => artistRef.get());

        if (artistDoc.exists) {
          const artistData = artistDoc.data();
          let activeEventIds = artistData?.activeEventIds || [];

          if (status === 'approved') {
            // 加入 eventId（如果尚未存在）
            if (!activeEventIds.includes(eventId)) {
              activeEventIds.push(eventId);
            }
          } else if (status === 'rejected') {
            // 移除 eventId
            activeEventIds = activeEventIds.filter((id: string) => id !== eventId);
          }

          batch.update(artistRef, { activeEventIds });
        }
      }

      await withTimeoutAndRetry(() => batch.commit());
    } catch (error) {
      console.error('Error updating artists activeEventIds:', error);
    }
  }

  async deleteEvent(eventId: string, userId: string, userRole: string): Promise<void> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(eventId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('活動不存在');
    }

    const eventData = doc.data();

    // 檢查權限：管理員可以刪除任何活動，一般用戶只能刪除自己的活動
    if (userRole !== 'admin' && eventData?.createdBy !== userId) {
      throw new Error('權限不足');
    }

    // 從相關 artists 的 activeEventIds 中移除
    if (eventData?.artists && Array.isArray(eventData.artists)) {
      await this.removeEventFromArtists(
        eventData.artists.map((a: { id: string }) => a.id),
        eventId
      );
    }

    // 直接刪除文件（不再使用軟刪除）
    await withTimeoutAndRetry(() => docRef.delete());

    // 清除相關快取
    cache.clearPattern('events:');
    cache.clearPattern('map-data:');
    cache.delete(`event:${eventId}`);

    // 清除相關 artists 的 eventCount 快取
    if (eventData?.artists && Array.isArray(eventData.artists)) {
      eventData.artists.forEach((artist: { id: string }) => {
        cache.delete(`artist:${artist.id}:eventCount`);
      });
    }

    // 清除 artists 統計快取（因為刪除事件會影響藝人的活動數量）
    cache.clearPattern('artists:stats:');
  }

  // 從 artists 的 activeEventIds 中移除 eventId
  private async removeEventFromArtists(artistIds: string[], eventId: string): Promise<void> {
    if (!db) return;

    try {
      const batch = db.batch();

      for (const artistId of artistIds) {
        const artistRef = db.collection('artists').doc(artistId);
        const artistDoc = await withTimeoutAndRetry(() => artistRef.get());

        if (artistDoc.exists) {
          const artistData = artistDoc.data();
          let activeEventIds = artistData?.activeEventIds || [];

          // 移除 eventId
          activeEventIds = activeEventIds.filter((id: string) => id !== eventId);

          batch.update(artistRef, { activeEventIds });
        }
      }

      await withTimeoutAndRetry(() => batch.commit());
    } catch (error) {
      console.error('Error removing event from artists:', error);
    }
  }

  async searchEvents(criteria: {
    query?: string;
    artistName?: string;
    location?: string;
  }): Promise<CoffeeEvent[]> {
    this.checkFirebaseConfig();

    const cacheKey = `events:search:${JSON.stringify(criteria)}`;
    const cachedResult = cache.get<CoffeeEvent[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const now = Timestamp.now();
    const query = this.collection.where('status', '==', 'approved');

    // 基本的搜尋功能（Firestore 的搜尋功能有限）
    const snapshot = await withTimeoutAndRetry(() => query.get());
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

    const result = events.sort((a, b) => a.datetime.start.toMillis() - b.datetime.start.toMillis());

    // 設定 3 分鐘快取
    cache.set(cacheKey, result, 3);

    return result;
  }

  // 獲取用戶的所有投稿（藝人和活動）
  async getUserSubmissions(userId: string): Promise<UserSubmissionsResponse> {
    this.checkFirebaseConfig();

    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }

    // 獲取用戶的藝人投稿（簡化查詢避免索引問題）
    const artistsSnapshot = await withTimeoutAndRetry(() =>
      db.collection('artists').where('createdBy', '==', userId).get()
    );

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
    const eventsSnapshot = await withTimeoutAndRetry(() =>
      this.collection.where('createdBy', '==', userId).get()
    );

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

    const expiredEvents = await withTimeoutAndRetry(() =>
      this.collection.where('datetime.end', '<', oneWeekAgo).get()
    );

    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
    const batch = db.batch();

    expiredEvents.docs.forEach(doc => {
      // 直接刪除過期活動（不再使用軟刪除）
      batch.delete(doc.ref);
    });

    await batch.commit();
  }

  // 輔助函數：將 Firestore Timestamp 轉為毫秒
  private timestampToMillis(timestamp: Timestamp): number {
    return (
      (timestamp as unknown as { _seconds: number; _nanoseconds: number })._seconds * 1000 +
      (timestamp as unknown as { _seconds: number; _nanoseconds: number })._nanoseconds / 1000000
    );
  }

  // 私有方法：活動排序
  private sortEvents(
    events: CoffeeEvent[],
    sortBy?: 'title' | 'startTime' | 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): CoffeeEvent[] {
    if (!sortBy) {
      // 預設按創建時間排序（最新在前）
      return events.sort((a, b) => {
        return this.timestampToMillis(b.createdAt) - this.timestampToMillis(a.createdAt);
      });
    }

    return events.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'startTime':
          comparison =
            this.timestampToMillis(a.datetime.start) - this.timestampToMillis(b.datetime.start);
          break;
        case 'createdAt':
          comparison = this.timestampToMillis(a.createdAt) - this.timestampToMillis(b.createdAt);
          break;
        default:
          comparison = this.timestampToMillis(b.createdAt) - this.timestampToMillis(a.createdAt);
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }
}
