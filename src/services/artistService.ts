import { db, hasFirebaseConfig } from '../config/firebase';
import { Artist, CreateArtistData, ArtistFilterParams, ArtistWithStats } from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';

export class ArtistService {
  private collection = hasFirebaseConfig && db ? db.collection('artists') : null;

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
      query = query.where('status', '==', status);
    }

    // 如果有指定創建者，就篩選
    if (createdBy) {
      query = query.where('createdBy', '==', createdBy);
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
      groupName: artistData.groupName || undefined,
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

  async updateArtistStatus(artistId: string, status: 'approved' | 'rejected'): Promise<Artist> {
    this.checkFirebaseConfig();
    const docRef = this.collection!.doc(artistId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Artist not found');
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
    } as Artist;
  }

  async deleteArtist(artistId: string): Promise<void> {
    this.checkFirebaseConfig();

    // 檢查是否有活動使用此藝人
    if (!db) {
      throw new Error('Firebase not configured');
    }
    const eventsSnapshot = await db
      .collection('coffeeEvents')
      .where('artistId', '==', artistId)
      .where('isDeleted', '==', false)
      .get();

    if (!eventsSnapshot.empty) {
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
      query = query.where('status', '==', filters.status);
    }

    // 創建者篩選
    if (filters.createdBy) {
      query = query.where('createdBy', '==', filters.createdBy);
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
          (artist.realName && artist.realName.toLowerCase().includes(searchTerm)) ||
          (artist.groupName && artist.groupName.toLowerCase().includes(searchTerm))
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
        .where('artistId', '==', artistId)
        .where('isDeleted', '==', false)
        .where('status', '==', 'approved')
        .get();

      // 在記憶體中篩選進行中的活動
      const activeEvents = eventsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const startTime = data.datetime?.start;
        const endTime = data.datetime?.end;

        if (!startTime || !endTime) return false;

        return startTime.toMillis() <= now.toMillis() && endTime.toMillis() >= now.toMillis();
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
