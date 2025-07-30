import { db, hasFirebaseConfig } from '../config/firebase';
import { Artist, CreateArtistData } from '../models/types';
import { Timestamp } from 'firebase-admin/firestore';

export class ArtistService {
  private collection = hasFirebaseConfig ? db.collection('artists') : null;

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

  async getArtistsByStatus(status?: 'approved' | 'pending' | 'rejected'): Promise<Artist[]> {
    this.checkFirebaseConfig();

    let query = this.collection!;

    // 如果有指定狀態，就篩選
    if (status) {
      query = query.where('status', '==', status);
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
}
