import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import {
  Artist,
  CreateArtistData,
  UpdateArtistData,
  ArtistFilterParams,
  AdminArtistUpdate,
} from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';
import { cache } from '../utils/cache';

export class ArtistService {
  private collection = hasFirebaseConfig && db ? db.collection('artists') : null;

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
      this.collection.where('status', '==', 'approved').orderBy('stageName', 'asc').get()
    );

    const sortedArtists = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );

    // 設定 24 小時快取（基礎資料變動不頻繁）
    cache.set(cacheKey, sortedArtists, 1440);

    return sortedArtists;
  }

  async getPendingArtists(): Promise<Artist[]> {
    this.checkFirebaseConfig();
    const snapshot = await withTimeoutAndRetry(() =>
      this.collection.where('status', '==', 'pending').orderBy('createdAt', 'desc').get()
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
      ttl = status === 'approved' ? 1440 : 60; // approved: 24小時, rejected: 1小時

      const cachedResult = cache.get<Artist[]>(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }
    }

    let query = this.collection;

    // 如果有指定狀態，就篩選
    if (status) {
      query = query.where('status', '==', status) as any;
    }

    // 如果有指定創建者，就篩選
    if (createdBy) {
      query = query.where('createdBy', '==', createdBy) as any;
    }

    const snapshot = await withTimeoutAndRetry(() => query.get());

    const artists = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );

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

    const docRef = await withTimeoutAndRetry(() => this.collection.add(newArtist));

    // 清除相關快取（新增 pending 藝人會影響 pending 列表）
    cache.clearPattern('artists:status:pending');
    cache.clearPattern('artists:filters:');

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
    const docRef = this.collection.doc(artistId);

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

      // 如果是審核通過且有管理員更新團名，應用更新
      if (adminUpdate?.groupNames !== undefined) {
        updateData.groupNames =
          adminUpdate.groupNames && adminUpdate.groupNames.length > 0
            ? adminUpdate.groupNames
            : undefined;
      }
    }

    // 直接更新，前端已處理存在性和權限檢查
    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 清除相關快取
    cache.delete('artists:approved');
    cache.delete(`artist:${artistId}`);
    // 清除篩選快取（因為藝人狀態改變會影響篩選結果）
    cache.clearPattern('artists:filters:');
    // 清除狀態快取（因為藝人狀態改變會影響狀態查詢結果）
    cache.clearPattern('artists:status:');
    // 注意：藝人狀態改變不會影響統計結果，所以不需要清除統計快取

    // 只返回更新的欄位，前端已有完整資料
    return {
      id: artistId,
      ...updateData,
    } as Artist;
  }

  // 編輯藝人資料
  async updateArtist(
    artistId: string,
    artistData: UpdateArtistData,
    userId: string,
    userRole: string
  ): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(artistId);

    // 讀取一次檢查存在性和權限
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('藝人不存在');
    }

    const existingData = doc.data();

    // 檢查權限：管理員可以編輯任何藝人，一般用戶只能編輯自己的投稿
    if (userRole !== 'admin' && existingData?.createdBy !== userId) {
      throw new Error('權限不足');
    }

    const updateData: Record<string, any> = {
      ...artistData,
      updatedAt: Timestamp.now(),
    };

    // 直接更新
    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 清除相關快取
    cache.delete('artists:approved');
    cache.delete(`artist:${artistId}`);
    // 清除篩選快取（因為藝人資料改變會影響篩選結果）
    cache.clearPattern('artists:filters:');
    // 清除狀態快取（因為藝人資料改變會影響狀態查詢結果）
    cache.clearPattern('artists:status:');
    // 注意：藝人資料改變不會影響統計結果，所以不需要清除統計快取

    // 返回更新的欄位和 ID
    return {
      id: artistId,
      ...updateData,
    } as Artist;
  }

  // 批次審核藝人 (支援個別團名更新)
  async batchUpdateArtistStatus(
    updates: Array<{
      artistId: string;
      status: 'approved' | 'rejected' | 'exists';
      reason?: string;
      groupNames?: string[];
    }>
  ): Promise<Artist[]> {
    this.checkFirebaseConfig();

    if (updates.length === 0) {
      return [];
    }

    // 使用 Firestore 的 batch 操作
    const batch = db.batch();

    // 為每個藝人建立個別的更新資料
    for (const update of updates) {
      const docRef = this.collection.doc(update.artistId);

      const updateData: Record<string, any> = {
        status: update.status,
        updatedAt: Timestamp.now(),
      };

      // 如果是 rejected 且有提供 reason，則加入 rejectedReason
      if (update.status === 'rejected' && update.reason) {
        updateData.rejectedReason = update.reason;
      }
      // 如果是 approved 或 exists，清除之前的 rejectedReason
      else if (update.status === 'approved' || update.status === 'exists') {
        updateData.rejectedReason = null;

        // 如果有提供團名，應用更新
        if (update.groupNames !== undefined) {
          updateData.groupNames =
            update.groupNames && update.groupNames.length > 0 ? update.groupNames : undefined;
        }
      }

      batch.update(docRef, updateData);
    }

    // 執行批次操作
    await withTimeoutAndRetry(() => batch.commit());

    // 清除相關快取
    cache.delete('artists:approved');
    cache.delete('artists:pending');
    cache.delete('artists:rejected');
    // 清除篩選快取（因為藝人狀態改變會影響篩選結果）
    cache.clearPattern('artists:filters:');
    // 清除狀態快取（因為藝人狀態改變會影響狀態查詢結果）
    cache.clearPattern('artists:status:');
    // 注意：藝人狀態改變不會影響統計結果，所以不需要清除統計快取

    // 清除相關藝人的個別快取
    for (const update of updates) {
      cache.delete(`artist:${update.artistId}`);
    }

    // 返回更新的結果
    const results: Artist[] = updates.map(update => ({
      id: update.artistId,
      status: update.status,
      rejectedReason: update.status === 'rejected' ? update.reason || null : null,
      groupNames: update.groupNames || undefined,
      updatedAt: Timestamp.now(),
    })) as Artist[];

    return results;
  }

  // 重新送審功能
  async resubmitArtist(artistId: string, userId: string): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(artistId);

    // 讀取一次檢查存在性、權限和狀態
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('藝人不存在');
    }

    const existingData = doc.data();

    // 檢查權限：只有創建者可以重新送審
    if (existingData?.createdBy !== userId) {
      throw new Error('權限不足: 只能重新送審自己的投稿');
    }

    // 只有 rejected 狀態可以重新送審
    if (existingData?.status !== 'rejected') {
      throw new Error('只能重新送審已拒絕的藝人');
    }

    const updateData = {
      status: 'pending' as const,
      rejectedReason: null, // 清除拒絕原因
      updatedAt: Timestamp.now(),
    };

    await withTimeoutAndRetry(() => docRef.update(updateData));

    // 清除相關快取
    cache.delete('artists:approved');
    cache.delete('artists:pending');
    cache.delete(`artist:${artistId}`);
    // 清除篩選快取（因為藝人狀態改變會影響篩選結果）
    cache.clearPattern('artists:filters:');
    // 清除狀態快取（因為藝人狀態改變會影響狀態查詢結果）
    cache.clearPattern('artists:status:');
    // 注意：resubmit 不會影響已審核藝人的統計，所以不需要清除統計快取

    return {
      id: artistId,
      ...existingData,
      ...updateData,
    } as Artist;
  }

  async deleteArtist(artistId: string): Promise<void> {
    this.checkFirebaseConfig();

    // 檢查是否有活動使用此藝人（搜尋 artists 陣列中的 id）
    if (!db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
    const eventsSnapshot = await withTimeoutAndRetry(() => db.collection('coffeeEvents').get());

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

    await withTimeoutAndRetry(() => this.collection.doc(artistId).delete());
  }

  async getArtistById(artistId: string): Promise<Artist | null> {
    this.checkFirebaseConfig();

    const cacheKey = `artist:${artistId}`;
    const cachedResult = cache.get<Artist | null>(cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }

    const doc = await withTimeoutAndRetry(() => this.collection.doc(artistId).get());

    if (!doc.exists) {
      // 快取 null 結果
      cache.set(cacheKey, null, 15);
      return null;
    }

    const artist = {
      id: doc.id,
      ...doc.data(),
    } as Artist;

    // 設定 6 小時快取
    cache.set(cacheKey, artist, 360);

    return artist;
  }

  // 新增：支援進階篩選的藝人查詢
  async getArtistsWithFilters(filters: ArtistFilterParams): Promise<Artist[]> {
    this.checkFirebaseConfig();

    // 如果是 approved 狀態，優先使用基礎快取
    if (filters.status === 'approved') {
      return this.getApprovedArtistsWithFilters(filters);
    }

    // 非 approved 狀態或沒有指定狀態，使用原本邏輯
    const cacheKey = `artists:filters:${JSON.stringify(filters)}`;
    const cachedResult = cache.get<Artist[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    let query = this.collection;

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
      return {
        id: doc.id,
        ...data,
      } as Artist;
    });

    // 在記憶體中篩選，並加上 coffeeEventCount
    artists = this.filterArtistsInMemory(artists, filters).map(
      artist =>
        ({
          ...artist,
          coffeeEventCount: artist.activeEventIds?.length || 0, // 加入 coffeeEventCount 用於前端
        }) as any
    );

    // 排序處理
    const sortedArtists = this.sortArtists(artists, filters.sortBy, filters.sortOrder);

    // 設定 4 小時快取（因為非基礎資料）
    cache.set(cacheKey, sortedArtists, 240);

    return sortedArtists;
  }

  // 私有方法：使用基礎快取的 approved 藝人篩選
  private async getApprovedArtistsWithFilters(filters: ArtistFilterParams): Promise<Artist[]> {
    // 先嘗試從基礎快取取得所有 approved 藝人
    let approvedArtists = cache.get<Artist[]>('artists:approved');

    if (!approvedArtists) {
      // 沒有快取才查詢 Firestore
      const snapshot = await withTimeoutAndRetry(() =>
        this.collection.where('status', '==', 'approved').orderBy('stageName', 'asc').get()
      );

      approvedArtists = snapshot.docs.map(
        doc =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as Artist
      );

      // 設定 24 小時快取
      cache.set('artists:approved', approvedArtists, 1440);
    }

    // 在記憶體中篩選，並加上 coffeeEventCount
    const filteredArtists = this.filterArtistsInMemory(approvedArtists, filters).map(
      artist =>
        ({
          ...artist,
          coffeeEventCount: artist.activeEventIds?.length || 0, // 加入 coffeeEventCount 用於前端
        }) as any
    );

    // 排序處理
    return this.sortArtists(filteredArtists, filters.sortBy, filters.sortOrder);
  }

  // 私有方法：記憶體中篩選藝人
  private filterArtistsInMemory(artists: Artist[], filters: ArtistFilterParams): Artist[] {
    let result = [...artists];

    // 創建者篩選
    if (filters.createdBy) {
      result = result.filter(artist => artist.createdBy === filters.createdBy);
    }

    // 生日週篩選
    if (filters.birthdayWeek) {
      result = this.filterByBirthdayWeek(result, filters.birthdayWeek);
    }

    // 搜尋篩選
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      result = result.filter(
        artist =>
          artist.stageName.toLowerCase().includes(searchTerm) ||
          (artist.stageNameZh && artist.stageNameZh.toLowerCase().includes(searchTerm)) ||
          (artist.groupNames &&
            artist.groupNames.some(name => name.toLowerCase().includes(searchTerm))) ||
          (artist.realName && artist.realName.toLowerCase().includes(searchTerm))
      );
    }

    return result;
  }

  // 私有方法：篩選生日週
  private filterByBirthdayWeek(
    artists: Artist[],
    birthdayWeek: { startDate: string; endDate: string }
  ): Artist[] {
    return artists.filter(artist => {
      if (!artist.birthday) return false;

      // 從查詢參數中提取年份，將生日轉換為該年份的日期進行比較
      const queryYear = new Date(birthdayWeek.startDate).getFullYear();
      const [, month, day] = artist.birthday.split('-');
      const birthdayInQueryYear = `${queryYear}-${month}-${day}`;

      return (
        birthdayInQueryYear >= birthdayWeek.startDate && birthdayInQueryYear <= birthdayWeek.endDate
      );
    });
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
    sortBy?: 'stageName' | 'coffeeEventCount' | 'createdAt' | 'birthday',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Artist[] {
    if (!sortBy) {
      // 預設按生日排序
      return this.sortByBirthday(artists, 'asc');
    }

    // 特殊處理生日排序和生咖數量排序
    if (sortBy === 'birthday') {
      return this.sortByBirthday(artists, sortOrder);
    }

    if (sortBy === 'coffeeEventCount') {
      return [...artists].sort((a, b) => {
        const aCount = (a as any).coffeeEventCount;
        const bCount = (b as any).coffeeEventCount;

        // 主要排序：生咖數量
        if (aCount !== bCount) {
          return sortOrder === 'desc' ? bCount - aCount : aCount - bCount;
        }

        // 次要排序：生咖數量相同時，按生日排序 (生日早的在前)
        if (a.birthday && b.birthday) {
          const [, aMonth, aDay] = a.birthday.split('-').map(Number);
          const [, bMonth, bDay] = b.birthday.split('-').map(Number);
          const aDate = aMonth * 100 + aDay; // 例：0218
          const bDate = bMonth * 100 + bDay; // 例：0222
          return aDate - bDate; // 218 - 222 = -4，所以 2/18 排在前面
        } else if (a.birthday && !b.birthday) {
          return -1; // 有生日的排前面
        } else if (!a.birthday && b.birthday) {
          return 1; // 有生日的排前面
        } else {
          // 都沒生日，按藝名排序
          return a.stageName.localeCompare(b.stageName);
        }
      });
    }

    // 一般排序處理
    return [...artists].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
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

  // 私有方法：專門的生日排序
  private sortByBirthday(artists: Artist[], sortOrder: 'asc' | 'desc' = 'asc'): Artist[] {
    return [...artists].sort((a, b) => {
      // 有生日的排在沒有生日的前面
      if (a.birthday && !b.birthday) return -1;
      if (!a.birthday && b.birthday) return 1;

      // 都沒有生日時，按藝名排序
      if (!a.birthday && !b.birthday) {
        return a.stageName.localeCompare(b.stageName);
      }

      // 都有生日時，按月日排序（忽略年份）
      if (a.birthday && b.birthday) {
        const [, aMonth, aDay] = a.birthday.split('-').map(Number);
        const [, bMonth, bDay] = b.birthday.split('-').map(Number);
        const aDate = aMonth * 100 + aDay; // 例：0218
        const bDate = bMonth * 100 + bDay; // 例：0222

        const comparison = aDate - bDate;
        return sortOrder === 'desc' ? -comparison : comparison;
      }

      return 0;
    });
  }
}
