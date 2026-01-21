import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import {
  User,
  UpdateUserData,
  UserFavorite,
  FavoriteFilterParams,
  FavoritesResponse,
  CoffeeEvent,
} from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';
import { cache } from '../utils/cache';

export class UserService {
  private collection = hasFirebaseConfig && db ? db.collection('users') : null;
  private favoritesCollection = hasFirebaseConfig && db ? db.collection('userFavorites') : null;
  private eventsCollection = hasFirebaseConfig && db ? db.collection('coffeeEvents') : null;

  private checkFirebaseConfig() {
    if (
      !hasFirebaseConfig ||
      !this.collection ||
      !this.favoritesCollection ||
      !this.eventsCollection
    ) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  async getUserById(userId: string): Promise<User | null> {
    this.checkFirebaseConfig();
    const doc = await withTimeoutAndRetry(() => this.collection.doc(userId).get());

    if (!doc.exists) {
      return null;
    }

    return {
      uid: doc.id,
      ...doc.data(),
    } as User;
  }

  async updateUser(userId: string, userData: UpdateUserData): Promise<User> {
    this.checkFirebaseConfig();
    const docRef = this.collection.doc(userId);
    const doc = await withTimeoutAndRetry(() => docRef.get());

    if (!doc.exists) {
      throw new Error('用戶不存在');
    }

    const updateData = {
      ...userData,
      updatedAt: Timestamp.now(),
    };

    await withTimeoutAndRetry(() => docRef.update(updateData));

    const updatedDoc = await withTimeoutAndRetry(() => docRef.get());
    return {
      uid: updatedDoc.id,
      ...updatedDoc.data(),
    } as User;
  }

  async createUser(userData: Omit<User, 'uid' | 'createdAt'>): Promise<User> {
    this.checkFirebaseConfig();
    const now = Timestamp.now();
    const newUser = {
      ...userData,
      createdAt: now,
    };

    const docRef = await withTimeoutAndRetry(() => this.collection.add(newUser));

    return {
      uid: docRef.id,
      ...newUser,
    };
  }

  // ==================== 收藏相關方法 ====================

  // 新增收藏
  async addFavorite(userId: string, eventId: string): Promise<UserFavorite> {
    this.checkFirebaseConfig();

    // 檢查活動是否存在
    const eventDoc = await withTimeoutAndRetry(() => this.eventsCollection.doc(eventId).get());
    if (!eventDoc.exists) {
      throw new Error('活動不存在');
    }

    // 檢查是否已經收藏
    const existingFavorite = await withTimeoutAndRetry(() =>
      this.favoritesCollection.where('userId', '==', userId).where('eventId', '==', eventId).get()
    );

    if (!existingFavorite.empty) {
      throw new Error('已經收藏過此活動');
    }

    const now = Timestamp.now();
    const favoriteData = {
      userId,
      eventId,
      createdAt: now,
    };

    const docRef = await withTimeoutAndRetry(() => this.favoritesCollection.add(favoriteData));

    // 清除相關快取
    cache.delete(`favorite:${userId}:${eventId}`);
    cache.clearPattern(`favorites:${userId}:`);

    return {
      id: docRef.id,
      ...favoriteData,
    };
  }

  // 取消收藏
  async removeFavorite(userId: string, eventId: string): Promise<void> {
    this.checkFirebaseConfig();

    const snapshot = await withTimeoutAndRetry(() =>
      this.favoritesCollection.where('userId', '==', userId).where('eventId', '==', eventId).get()
    );

    if (snapshot.empty) {
      throw new Error('收藏不存在');
    }

    // 刪除找到的收藏記錄
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await withTimeoutAndRetry(() => batch.commit());

    // 清除相關快取
    cache.delete(`favorite:${userId}:${eventId}`);
    cache.clearPattern(`favorites:${userId}:`);
  }

  // 檢查是否已收藏
  async isFavorited(userId: string, eventId: string): Promise<boolean> {
    this.checkFirebaseConfig();

    // 檢查快取
    const cacheKey = `favorite:${userId}:${eventId}`;
    const cachedResult = cache.get<boolean>(cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }

    const snapshot = await withTimeoutAndRetry(() =>
      this.favoritesCollection
        .where('userId', '==', userId)
        .where('eventId', '==', eventId)
        .limit(1)
        .get()
    );

    const result = !snapshot.empty;

    // 設定 24 小時快取
    cache.set(cacheKey, result, 1440);

    return result;
  }

  // 批量檢查是否已收藏
  async checkFavoritesBatch(userId: string, eventIds: string[]): Promise<Set<string>> {
    this.checkFirebaseConfig();

    if (eventIds.length === 0) {
      return new Set();
    }

    // Firestore 的 in 查詢最多支援 30 個值，需要分批查詢
    const batchSize = 30;
    const favoritedEventIds = new Set<string>();

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batchEventIds = eventIds.slice(i, i + batchSize);
      const snapshot = await withTimeoutAndRetry(() =>
        this.favoritesCollection
          .where('userId', '==', userId)
          .where('eventId', 'in', batchEventIds)
          .get()
      );

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        favoritedEventIds.add(data.eventId);
      });
    }

    return favoritedEventIds;
  }

  // 取得收藏列表
  async getFavorites(userId: string, filters: FavoriteFilterParams): Promise<FavoritesResponse> {
    this.checkFirebaseConfig();

    // 設定預設值
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const skip = (page - 1) * limit;
    const status = filters.status || 'notEnded';
    const sort = filters.sort || 'favoritedAt';
    const sortOrder = filters.sortOrder || 'desc';

    // 檢查快取
    const cacheKey = `favorites:${userId}:${JSON.stringify(filters)}`;
    const cachedResult = cache.get<FavoritesResponse>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 取得用戶所有收藏
    const favoritesSnapshot = await withTimeoutAndRetry(() =>
      this.favoritesCollection.where('userId', '==', userId).get()
    );

    if (favoritesSnapshot.empty) {
      const emptyResult: FavoritesResponse = {
        favorites: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
      // 空結果也快取，避免重複查詢
      cache.set(cacheKey, emptyResult, 1440);
      return emptyResult;
    }

    // 取得所有收藏的活動 ID
    const favorites = favoritesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as UserFavorite[];

    const eventIds = favorites.map(f => f.eventId);

    // 批量取得活動資料（Firestore 的 in 查詢最多 30 個）
    const batchSize = 30;
    const eventsMap = new Map<string, CoffeeEvent>();

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batchEventIds = eventIds.slice(i, i + batchSize);
      const eventsSnapshot = await withTimeoutAndRetry(() =>
        this.eventsCollection.where('__name__', 'in', batchEventIds).get()
      );

      eventsSnapshot.docs.forEach(doc => {
        eventsMap.set(doc.id, {
          id: doc.id,
          ...doc.data(),
        } as CoffeeEvent);
      });
    }

    // 組合收藏和活動資料
    let results = favorites
      .map(favorite => {
        const event = eventsMap.get(favorite.eventId);
        if (!event) return null;
        return { favorite, event };
      })
      .filter((item): item is { favorite: UserFavorite; event: CoffeeEvent } => item !== null);

    // 只顯示 approved 的活動
    results = results.filter(item => item.event.status === 'approved');

    // 根據 status 篩選活動
    const now = Date.now();
    if (status !== 'all') {
      results = results.filter(item => {
        const startTime = item.event.datetime.start.toMillis();
        const endTime = item.event.datetime.end.toMillis();

        switch (status) {
          case 'notEnded':
            return endTime >= now;
          case 'active':
            return startTime <= now && endTime >= now;
          case 'upcoming':
            return startTime > now;
          case 'ended':
            return endTime < now;
          default:
            return true;
        }
      });
    }

    // 根據 artistIds 篩選
    if (filters.artistIds && filters.artistIds.length > 0) {
      results = results.filter(item =>
        item.event.artists.some(artist => filters.artistIds.includes(artist.id))
      );
    }

    // 排序
    results.sort((a, b) => {
      let comparison = 0;

      switch (sort) {
        case 'favoritedAt':
          comparison = a.favorite.createdAt.toMillis() - b.favorite.createdAt.toMillis();
          break;
        case 'startTime':
          comparison = a.event.datetime.start.toMillis() - b.event.datetime.start.toMillis();
          break;
        default:
          comparison = a.favorite.createdAt.toMillis() - b.favorite.createdAt.toMillis();
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // 計算總數和分頁
    const total = results.length;
    const totalPages = Math.ceil(total / limit);

    // 分頁處理
    const paginatedResults = results.slice(skip, skip + limit);

    const result: FavoritesResponse = {
      favorites: paginatedResults,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };

    // 設定 24 小時快取
    cache.set(cacheKey, result, 1440);

    return result;
  }

  // 取得用戶所有收藏的活動 ID（用於其他地方快速查詢）
  async getFavoriteEventIds(userId: string): Promise<string[]> {
    this.checkFirebaseConfig();

    const snapshot = await withTimeoutAndRetry(() =>
      this.favoritesCollection.where('userId', '==', userId).get()
    );

    return snapshot.docs.map(doc => doc.data().eventId);
  }

  // 刪除所有對某個活動的收藏（當活動被刪除時使用）
  async removeAllFavoritesForEvent(eventId: string): Promise<void> {
    this.checkFirebaseConfig();

    const snapshot = await withTimeoutAndRetry(() =>
      this.favoritesCollection.where('eventId', '==', eventId).get()
    );

    if (snapshot.empty) {
      return; // 沒有收藏記錄，直接返回
    }

    // 批次刪除所有相關收藏
    const batch = db.batch();
    const affectedUserIds = new Set<string>();

    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      affectedUserIds.add(doc.data().userId);
    });

    await withTimeoutAndRetry(() => batch.commit());

    // 清除所有受影響用戶的快取
    affectedUserIds.forEach(userId => {
      cache.clearPattern(`favorites:${userId}:`);
      cache.delete(`favorite:${userId}:${eventId}`);
    });
  }
}
