import { db, hasFirebaseConfig } from '../config/firebase';
import {
  Artist,
  CreateArtistData,
  UpdateArtistData,
  ArtistFilterParams,
  ArtistWithStats,
} from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';
import { NotificationHelper } from './notificationService';

export class ArtistService {
  private collection = hasFirebaseConfig && db ? db.collection('artists') : null;
  private notificationHelper = new NotificationHelper();

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase not configured');
    }
  }

  async getApprovedArtists(): Promise<Artist[]> {
    this.checkFirebaseConfig();
    // 暫時使用簡單查詢，等索引完全生效後再改回複合查詢
    const snapshot = await this.collection!.where('status', '==', 'approved').get();

    // 在程式中排序
    const artists = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );

    return artists.sort((a, b) => a.stageName.localeCompare(b.stageName));
  }

  async getPendingArtists(): Promise<Artist[]> {
    this.checkFirebaseConfig();
    const snapshot = await this.collection!.where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();

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

    let query = this.collection!;

    // 如果有指定狀態，就篩選
    if (status) {
      query = query.where('status', '==', status) as any;
    }

    // 如果有指定創建者，就篩選
    if (createdBy) {
      query = query.where('createdBy', '==', createdBy) as any;
    }

    const snapshot = await query.get();

    const artists = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );

    // 根據狀態決定排序方式
    if (status === 'pending') {
      return artists.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()); // 最新的在前
    } else {
      return artists.sort((a, b) => a.stageName.localeCompare(b.stageName)); // 藝名排序
    }
  }

  async createArtist(artistData: CreateArtistData, userId: string): Promise<Artist> {
    this.checkFirebaseConfig();

    // 檢查是否已存在相同藝名的藝人
    const existingArtist = await this.collection!.where('stageName', '==', artistData.stageName)
      .where('status', 'in', ['pending', 'approved'])
      .get();

    if (!existingArtist.empty) {
      throw new Error('Artist with this stage name already exists');
    }

    const now = Timestamp.now();
    const newArtist = {
      stageName: artistData.stageName,
      realName: artistData.realName || undefined,
      birthday: artistData.birthday || undefined,
      profileImage: artistData.profileImage || undefined,
      status: 'pending' as const,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await this.collection!.add(newArtist);

    return {
      id: docRef.id,
      ...newArtist,
    };
  }

  async updateArtistStatus(
    artistId: string,
    status: 'approved' | 'rejected' | 'exists',
    reason?: string
  ): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Artist not found');
    }

    const existingData = doc.data() as Artist;

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
    }

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();
    const updatedArtist = {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Artist;

    // 發送通知給用戶
    try {
      await this.notificationHelper.notifyArtistReview(
        existingData.createdBy,
        existingData.stageName,
        artistId,
        status,
        reason
      );
    } catch (notificationError) {
      console.error('Failed to send notification:', notificationError);
      // 不拋出錯誤，因為主要操作已成功
    }

    return updatedArtist;
  }

  // 編輯藝人資料
  async updateArtist(
    artistId: string,
    artistData: UpdateArtistData,
    userId: string
  ): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Artist not found');
    }

    const existingData = doc.data() as Artist;

    // 檢查權限：只有創建者可以編輯
    if (existingData.createdBy !== userId) {
      throw new Error('Permission denied: You can only edit your own submissions');
    }

    // 檢查狀態：只有 pending 和 rejected 狀態可以編輯
    if (!['pending', 'rejected'].includes(existingData.status)) {
      throw new Error('Can only edit artists with pending or rejected status');
    }

    const updateData: Record<string, any> = {
      ...artistData,
      updatedAt: Timestamp.now(),
    };

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Artist;
  }

  // 重新送審功能
  async resubmitArtist(artistId: string, userId: string): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Artist not found');
    }

    const existingData = doc.data() as Artist;

    // 檢查權限：只有創建者可以重新送審
    if (existingData.createdBy !== userId) {
      throw new Error('Permission denied: You can only resubmit your own submissions');
    }

    // 檢查狀態：不能重新送審已存在狀態的藝人
    if (existingData.status === 'exists') {
      throw new Error('Cannot resubmit artists with "exists" status');
    }

    // 只有 rejected 狀態可以重新送審
    if (existingData.status !== 'rejected') {
      throw new Error('Can only resubmit rejected artists');
    }

    const updateData = {
      status: 'pending' as const,
      rejectedReason: null, // 清除拒絕原因
      updatedAt: Timestamp.now(),
    };

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Artist;
  }

  async deleteArtist(artistId: string): Promise<void> {
    this.checkFirebaseConfig();

    // 檢查是否有活動使用此藝人（搜尋 artists 陣列中的 id）
    if (!db) {
      throw new Error('Firebase not configured');
    }
    const eventsSnapshot = await db.collection('coffeeEvents').get();

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
      throw new Error('Cannot delete artist with existing events');
    }

    await this.collection!.doc(artistId).delete();
  }

  async getArtistById(artistId: string): Promise<Artist | null> {
    this.checkFirebaseConfig();
    const doc = await this.collection!.doc(artistId).get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as Artist;
  }

  // 新增：支援進階篩選的藝人查詢
  async getArtistsWithFilters(filters: ArtistFilterParams): Promise<Artist[]> {
    this.checkFirebaseConfig();

    let query = this.collection!;

    // 狀態篩選
    if (filters.status) {
      query = query.where('status', '==', filters.status) as any;
    }

    // 創建者篩選
    if (filters.createdBy) {
      query = query.where('createdBy', '==', filters.createdBy) as any;
    }

    const snapshot = await query.get();
    let artists = snapshot.docs.map(
      doc =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Artist
    );

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
          (artist.realName && artist.realName.toLowerCase().includes(searchTerm))
      );
    }

    // 排序（基本方法暫時保持藝名排序）
    return artists.sort((a, b) => a.stageName.localeCompare(b.stageName));
  }

  // 新增：帶統計資料的藝人查詢
  async getArtistsWithStats(filters: ArtistFilterParams): Promise<ArtistWithStats[]> {
    this.checkFirebaseConfig();

    // 先取得藝人列表
    const artists = await this.getArtistsWithFilters(filters);

    // 為每個藝人計算生咖數量
    const artistsWithStats: ArtistWithStats[] = [];

    for (const artist of artists) {
      const coffeeEventCount = await this.getActiveEventCountForArtist(artist.id);
      artistsWithStats.push({
        ...artist,
        coffeeEventCount,
      });
    }

    // 套用排序
    return this.sortArtistsWithStats(artistsWithStats, filters.sortBy, filters.sortOrder);
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
  private async getActiveEventCountForArtist(artistId: string): Promise<number> {
    if (!db) {
      return 0;
    }

    const now = Timestamp.now();

    try {
      const eventsSnapshot = await db
        .collection('coffeeEvents')
        .where('status', '==', 'approved')
        .get();

      // 在記憶體中篩選包含此藝人且正在進行中的活動
      const activeEvents = eventsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const startTime = data.datetime?.start;
        const endTime = data.datetime?.end;
        const artists = data.artists;

        if (!startTime || !endTime || !artists || !Array.isArray(artists)) return false;

        // 檢查是否包含此藝人且時間在範圍內
        const hasArtist = artists.some((artist: any) => artist.id === artistId);
        const isActive =
          startTime.toMillis() <= now.toMillis() && endTime.toMillis() >= now.toMillis();

        return hasArtist && isActive;
      });

      return activeEvents.length;
    } catch (error) {
      console.error('Error counting active events for artist:', error);
      return 0;
    }
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
          comparison = a.createdAt.toMillis() - b.createdAt.toMillis();
          break;
        default:
          comparison = a.stageName.localeCompare(b.stageName);
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }
}
