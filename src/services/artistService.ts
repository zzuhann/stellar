import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import {
  Artist,
  CreateArtistData,
  UpdateArtistData,
  ArtistFilterParams,
  ArtistWithStats,
  AdminArtistUpdate,
} from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';
import { NotificationHelper } from './notificationService';
import { cache } from '../utils/cache';

export class ArtistService {
  private collection = hasFirebaseConfig && db ? db.collection('artists') : null;
  private notificationHelper = new NotificationHelper();

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  async getApprovedArtists(): Promise<Artist[]> {
    this.checkFirebaseConfig();

    const cacheKey = 'artists:approved';
    const cachedResult = cache.get<Artist[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 使用複合索引直接排序
    const snapshot = await withTimeoutAndRetry(() =>
      this.collection!.where('status', '==', 'approved').orderBy('stageName', 'asc').get()
    );

    const sortedArtists = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );

    // 設定 30 分鐘快取
    cache.set(cacheKey, sortedArtists, 30);

    return sortedArtists;
  }

  async getPendingArtists(): Promise<Artist[]> {
    this.checkFirebaseConfig();
    const snapshot = await withTimeoutAndRetry(() =>
      this.collection!.where('status', '==', 'pending').orderBy('createdAt', 'desc').get()
    );

    return snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );
  }

  async getArtistsByStatus(
    status?: 'approved' | 'pending' | 'rejected',
    createdBy?: string
  ): Promise<Artist[]> {
    this.checkFirebaseConfig();

    // 只有非 pending 狀態才快取
    let cacheKey: string | null = null;
    let ttl = 0;

    if (status && status !== 'pending') {
      cacheKey = `artists:status:${status}:${createdBy || 'all'}`;
      ttl = status === 'approved' ? 30 : 15; // approved: 30分鐘, rejected: 15分鐘

      const cachedResult = cache.get<Artist[]>(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }
    }

    let query = this.collection!;

    // 如果有指定狀態，就篩選
    if (status) {
      query = query.where('status', '==', status) as any;
    }

    // 如果有指定創建者，就篩選
    if (createdBy) {
      query = query.where('createdBy', '==', createdBy) as any;
    }

    const snapshot = await withTimeoutAndRetry(() => query.get());

    const artists = snapshot.docs.map(doc => {
      const data = doc.data();
      // 處理向後兼容：如果有舊的 groupName，轉換為 groupNames
      if (data.groupName && !data.groupNames) {
        data.groupNames = [data.groupName];
        delete data.groupName;
      }
      return {
        id: doc.id,
        ...data,
      } as Artist;
    });

    // 根據狀態決定排序方式
    let result: Artist[];
    if (status === 'pending') {
      result = artists.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()); // 最新的在前
    } else {
      result = artists.sort((a, b) => a.stageName.localeCompare(b.stageName)); // 藝名排序
    }

    // 設定快取（僅非 pending 狀態）
    if (cacheKey && ttl > 0) {
      cache.set(cacheKey, result, ttl);
    }

    return result;
  }

  async createArtist(artistData: CreateArtistData, userId: string): Promise<Artist> {
    this.checkFirebaseConfig();

    const now = Timestamp.now();
    const newArtist = {
      stageName: artistData.stageName,
      stageNameZh: artistData.stageNameZh || undefined,
      groupNames:
        artistData.groupNames && artistData.groupNames.length > 0
          ? artistData.groupNames
          : undefined,
      realName: artistData.realName || undefined,
      birthday: artistData.birthday || undefined,
      profileImage: artistData.profileImage || undefined,
      status: 'pending' as const,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await withTimeoutAndRetry(() => this.collection!.add(newArtist));

    return {
      id: docRef.id,
      ...newArtist,
    };
  }

  async updateArtistStatus(
    artistId: string,
    status: 'approved' | 'rejected' | 'exists',
    reason?: string,
    adminUpdate?: AdminArtistUpdate
  ): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);

    const updateData: Record<string, any> = {
      status,
      updatedAt: Timestamp.now(),
    };

    // 如果是 rejected 且有提供 reason，則加入 rejectedReason
    if (status === 'rejected' && reason) {
      updateData.rejectedReason = reason;
    }
    // 如果是 approved 或 exists，清除之前的 rejectedReason
    else if (status === 'approved' || status === 'exists') {
      updateData.rejectedReason = null;

      // 如果是審核通過且有管理員更新，應用更新
      if (adminUpdate) {
        if (adminUpdate.groupNames !== undefined) {
          updateData.groupNames =
            adminUpdate.groupNames && adminUpdate.groupNames.length > 0
              ? adminUpdate.groupNames
              : undefined;
        }
      }
    }

    // 直接更新，不檢查存在性
    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 只清除特定快取，保留其他快取
    cache.delete('artists:approved');
    cache.delete(`artist:${artistId}`);
    cache.delete(`artist:${artistId}:eventCount`);

    // 返回更新資料，不重新讀取
    return {
      id: artistId,
      ...updateData,
    } as Artist;
  }

  // 編輯藝人資料
  async updateArtist(
    artistId: string,
    artistData: UpdateArtistData,
    userId: string
  ): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('偶像不存在');
    }

    const existingData = doc.data() as Artist;

    // 檢查權限：只有創建者可以編輯
    if (existingData.createdBy !== userId) {
      throw new Error('權限不足: 只能編輯自己的投稿');
    }

    // 檢查狀態：只有 pending 和 rejected 狀態可以編輯
    if (!['pending', 'rejected'].includes(existingData.status)) {
      throw new Error('只能編輯待審核或已拒絕的投稿');
    }

    const updateData: Record<string, any> = {
      ...artistData,
      updatedAt: Timestamp.now(),
    };

    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 只清除特定快取，保留其他快取
    cache.delete('artists:approved');
    cache.delete(`artist:${artistId}`);
    cache.delete(`artist:${artistId}:eventCount`);

    // 直接構建更新後的物件，避免快取或讀取問題
    return {
      ...existingData,
      ...updateData,
      id: artistId,
    } as Artist;
  }

  // 批次審核藝人
  async batchUpdateArtistStatus(
    artistIds: string[],
    status: 'approved' | 'rejected' | 'exists',
    reason?: string,
    adminUpdate?: AdminArtistUpdate
  ): Promise<Artist[]> {
    this.checkFirebaseConfig();

    if (artistIds.length === 0) {
      return [];
    }

    // 使用 Firestore 的 batch 操作
    const batch = db!.batch();
    const results: Artist[] = [];

    for (const artistId of artistIds) {
      const docRef = this.collection!.doc(artistId);

      const updateData: Record<string, any> = {
        status,
        updatedAt: Timestamp.now(),
      };

      // 如果是 rejected 且有提供 reason，則加入 rejectedReason
      if (status === 'rejected' && reason) {
        updateData.rejectedReason = reason;
      }
      // 如果是 approved 或 exists，清除之前的 rejectedReason
      else if (status === 'approved' || status === 'exists') {
        updateData.rejectedReason = null;

        // 如果是審核通過且有管理員更新，應用更新
        if (adminUpdate) {
          if (adminUpdate.groupNames !== undefined) {
            updateData.groupNames =
              adminUpdate.groupNames && adminUpdate.groupNames.length > 0
                ? adminUpdate.groupNames
                : undefined;
          }
        }
      }

      batch.update(docRef, updateData);

      results.push({
        id: artistId,
        ...updateData,
      } as Artist);
    }

    // 執行批次操作
    await withTimeoutAndRetry(() => batch.commit());

    // 批次清除快取
    cache.delete('artists:approved');
    cache.delete('artists:pending');
    cache.delete('artists:rejected');

    // 清除相關藝人的快取
    for (const artistId of artistIds) {
      cache.delete(`artist:${artistId}`);
      cache.delete(`artist:${artistId}:eventCount`);
    }

    return results;
  }

  // 重新送審功能
  async resubmitArtist(artistId: string, userId: string): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('偶像不存在');
    }

    const existingData = doc.data() as Artist;

    // 檢查權限：只有創建者可以重新送審
    if (existingData.createdBy !== userId) {
      throw new Error('權限不足: 只能重新送審自己的投稿');
    }

    // 檢查狀態：不能重新送審已存在狀態的藝人
    if (existingData.status === 'exists') {
      throw new Error('無法重新送審已通過審核的偶像');
    }

    // 只有 rejected 狀態可以重新送審
    if (existingData.status !== 'rejected') {
      throw new Error('只能重新送審已拒絕的投稿');
    }

    const updateData = {
      status: 'pending' as const,
      rejectedReason: null, // 清除拒絕原因
      updatedAt: Timestamp.now(),
    };

    await withTimeoutAndRetry(() => docRef.update(updateData));

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Artist;
  }

  async deleteArtist(artistId: string): Promise<void> {
    this.checkFirebaseConfig();

    // 檢查是否有活動使用此藝人（搜尋 artists 陣列中的 id）
    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
    const eventsSnapshot = await withTimeoutAndRetry(() => db!.collection('coffeeEvents').get());

    // 在記憶體中搜尋使用此藝人的活動
    const hasEvents = eventsSnapshot.docs.some(doc => {
      const data = doc.data();
      return (
        data.artists &&
        Array.isArray(data.artists) &&
        data.artists.some((artist: any) => artist.id === artistId)
      );
    });

    if (hasEvents) {
      throw new Error('不能刪除已經有生咖活動的偶像');
    }

    await withTimeoutAndRetry(() => this.collection!.doc(artistId).delete());
  }

  async getArtistById(artistId: string): Promise<Artist | null> {
    this.checkFirebaseConfig();

    const cacheKey = `artist:${artistId}`;
    const cachedResult = cache.get<Artist | null>(cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }

    const doc = await withTimeoutAndRetry(() => this.collection!.doc(artistId).get());

    if (!doc.exists) {
      // 快取 null 結果
      cache.set(cacheKey, null, 15);
      return null;
    }

    const artist = {
      id: doc.id,
      ...doc.data(),
    } as Artist;

    // 設定 15 分鐘快取
    cache.set(cacheKey, artist, 15);

    return artist;
  }

  // 新增：支援進階篩選的藝人查詢
  async getArtistsWithFilters(filters: ArtistFilterParams): Promise<Artist[]> {
    this.checkFirebaseConfig();

    const cacheKey = `artists:filters:${JSON.stringify(filters)}`;
    const cachedResult = cache.get<Artist[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    let query = this.collection!;

    // 狀態篩選
    if (filters.status) {
      query = query.where('status', '==', filters.status) as any;
    }

    // 創建者篩選
    if (filters.createdBy) {
      query = query.where('createdBy', '==', filters.createdBy) as any;
    }

    const snapshot = await withTimeoutAndRetry(() => query.get());
    let artists = snapshot.docs.map(doc => {
      const data = doc.data();
      // 處理向後兼容：如果有舊的 groupName，轉換為 groupNames
      if (data.groupName && !data.groupNames) {
        data.groupNames = [data.groupName];
        delete data.groupName;
      }
      return {
        id: doc.id,
        ...data,
      } as Artist;
    });

    // 生日週篩選（在記憶體中處理）
    if (filters.birthdayWeek) {
      artists = this.filterByBirthdayWeek(artists, filters.birthdayWeek);
    }

    // 搜尋篩選（在記憶體中處理）
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      artists = artists.filter(
        artist =>
          artist.stageName.toLowerCase().includes(searchTerm) ||
          (artist.stageNameZh && artist.stageNameZh.toLowerCase().includes(searchTerm)) ||
          (artist.groupNames &&
            artist.groupNames.some(name => name.toLowerCase().includes(searchTerm))) ||
          (artist.realName && artist.realName.toLowerCase().includes(searchTerm))
      );
    }

    // 排序處理
    const sortedArtists = this.sortArtists(artists, filters.sortBy, filters.sortOrder);

    // 設定 30 分鐘快取
    cache.set(cacheKey, sortedArtists, 30);

    return sortedArtists;
  }

  // 新增：帶統計資料的藝人查詢
  async getArtistsWithStats(filters: ArtistFilterParams): Promise<ArtistWithStats[]> {
    this.checkFirebaseConfig();

    const cacheKey = `artists:stats:${JSON.stringify(filters)}`;
    const cachedResult = cache.get<ArtistWithStats[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 先取得藝人列表
    const artists = await this.getArtistsWithFilters(filters);

    // 為每個藝人計算生咖數量
    const artistsWithStats: ArtistWithStats[] = [];

    for (const artist of artists) {
      const coffeeEventCount = await this.getActiveEventCountForArtist(artist.id, artist);
      artistsWithStats.push({
        ...artist,
        coffeeEventCount,
      });
    }

    // 套用排序
    const result = this.sortArtistsWithStats(artistsWithStats, filters.sortBy, filters.sortOrder);

    // 設定 10 分鐘快取
    cache.set(cacheKey, result, 10);

    return result;
  }

  // 私有方法：篩選生日週
  private filterByBirthdayWeek(
    artists: Artist[],
    birthdayWeek: { startDate: string; endDate: string }
  ): Artist[] {
    return artists.filter(artist => {
      if (!artist.birthday) return false;

      // 將生日轉換為今年的日期進行比較
      const currentYear = new Date().getFullYear();
      const [, month, day] = artist.birthday.split('-');
      const birthdayThisYear = `${currentYear}-${month}-${day}`;

      return birthdayThisYear >= birthdayWeek.startDate && birthdayThisYear <= birthdayWeek.endDate;
    });
  }

  // 私有方法：計算藝人的進行中活動數量
  private async getActiveEventCountForArtist(artistId: string, artistData?: any): Promise<number> {
    if (!db) {
      return 0;
    }

    const cacheKey = `artist:${artistId}:eventCount`;
    const cachedResult = cache.get<number>(cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }

    const now = Timestamp.now();

    try {
      // 如果沒有傳入 artistData，才去讀取
      let activeEventIds: string[] = [];
      if (artistData) {
        activeEventIds = artistData.activeEventIds || [];
      } else {
        const artistDoc = await withTimeoutAndRetry(() =>
          db!.collection('artists').doc(artistId).get()
        );
        const data = artistDoc.data();
        activeEventIds = data?.activeEventIds || [];
      }

      if (activeEventIds.length === 0) {
        // 快取 0 結果，避免重複查詢
        cache.set(cacheKey, 0, 10); // 10 分鐘快取
        return 0;
      }

      // 只查詢相關的 events
      const eventsSnapshot = await withTimeoutAndRetry(() =>
        db!
          .collection('coffeeEvents')
          .where('__name__', 'in', activeEventIds)
          .where('status', '==', 'approved')
          .get()
      );

      // 在記憶體中檢查是否尚未結束
      const activeEvents = eventsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const endTime = data.datetime?.end;

        if (!endTime) return false;

        return endTime.toMillis() >= now.toMillis();
      });

      const count = activeEvents.length;

      // 設定 2 分鐘快取
      cache.set(cacheKey, count, 2);

      return count;
    } catch (error) {
      console.error('Error counting active events for artist:', error);
      return 0;
    }
  }

  // 輔助函數：將 Firestore Timestamp 轉為毫秒
  private timestampToMillis(timestamp: Timestamp): number {
    return (
      (timestamp as unknown as { _seconds: number; _nanoseconds: number })._seconds * 1000 +
      (timestamp as unknown as { _seconds: number; _nanoseconds: number })._nanoseconds / 1000000
    );
  }

  // 私有方法：基本藝人排序
  private sortArtists(
    artists: Artist[],
    sortBy?: 'stageName' | 'coffeeEventCount' | 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Artist[] {
    if (!sortBy) {
      // 預設按藝名排序
      return artists.sort((a, b) => a.stageName.localeCompare(b.stageName));
    }

    return artists.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'createdAt':
          comparison = this.timestampToMillis(a.createdAt) - this.timestampToMillis(b.createdAt);
          break;
        case 'coffeeEventCount':
          // 基本 Artist 沒有 coffeeEventCount，預設為 0
          comparison = 0;
          break;
        default:
          comparison = a.stageName.localeCompare(b.stageName);
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  // 私有方法：帶統計資料的藝人排序
  private sortArtistsWithStats(
    artists: ArtistWithStats[],
    sortBy?: 'stageName' | 'coffeeEventCount' | 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): ArtistWithStats[] {
    if (!sortBy) {
      // 預設按藝名排序
      return artists.sort((a, b) => a.stageName.localeCompare(b.stageName));
    }

    return artists.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'coffeeEventCount':
          comparison = a.coffeeEventCount - b.coffeeEventCount;
          break;
        case 'createdAt':
          comparison = this.timestampToMillis(a.createdAt) - this.timestampToMillis(b.createdAt);
          break;
        default:
          comparison = a.stageName.localeCompare(b.stageName);
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }
}
