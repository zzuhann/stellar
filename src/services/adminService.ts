import { db, hasFirebaseConfig } from '../config/firebase';
import { withTimeoutAndRetry } from '../utils/firestoreTimeout';
import { Artist, CoffeeEvent } from '../models/types';

export interface AdminQueryParams {
  search?: string;
  slug?: string;
  id?: string;
  status?: 'pending' | 'approved' | 'rejected';
  page?: number;
  limit?: number;
}

export interface AdminPaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AdminService {
  private eventsCollection = hasFirebaseConfig && db ? db.collection('coffeeEvents') : null;
  private artistsCollection = hasFirebaseConfig && db ? db.collection('artists') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !db) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  private resolvePagination(params: AdminQueryParams): {
    page: number;
    limit: number;
    skip: number;
  } {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(Math.max(1, params.limit ?? 20), 50);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
  }

  async getAdminEvents(params: AdminQueryParams): Promise<AdminPaginatedResponse<CoffeeEvent>> {
    this.checkFirebaseConfig();

    // id 精確查詢，優先處理
    if (params.id) {
      const doc = await withTimeoutAndRetry(() => this.eventsCollection!.doc(params.id!).get());
      if (!doc.exists) {
        return {
          data: [],
          pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 },
        };
      }
      const event = { id: doc.id, ...doc.data() } as CoffeeEvent;
      return {
        data: [event],
        pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 },
      };
    }

    // slug 精確查詢
    if (params.slug) {
      const snapshot = await withTimeoutAndRetry(() =>
        this.eventsCollection!.where('slug', '==', params.slug).limit(1).get()
      );
      if (snapshot.empty) {
        return {
          data: [],
          pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 },
        };
      }
      const event = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as CoffeeEvent;
      return {
        data: [event],
        pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 },
      };
    }

    const { page, limit, skip } = this.resolvePagination(params);

    // 無論有無 search，先用 status filter 拉全部（不加 orderBy 避免 index 問題）
    let baseQuery: FirebaseFirestore.Query = this.eventsCollection!;
    if (params.status) {
      baseQuery = baseQuery.where('status', '==', params.status);
    }

    const snapshot = await withTimeoutAndRetry(() => baseQuery.get());
    let events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CoffeeEvent);

    if (params.search) {
      const term = params.search.toLowerCase();
      events = events.filter(e => e.title?.toLowerCase().includes(term));
    }

    events.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });

    const total = events.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data: events.slice(skip, skip + limit), pagination: { page, limit, total, totalPages } };
  }

  async getAdminArtists(params: AdminQueryParams): Promise<AdminPaginatedResponse<Artist>> {
    this.checkFirebaseConfig();

    // id 精確查詢，優先處理
    if (params.id) {
      const doc = await withTimeoutAndRetry(() => this.artistsCollection!.doc(params.id!).get());
      if (!doc.exists) {
        return {
          data: [],
          pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 },
        };
      }
      const artist = { id: doc.id, ...doc.data() } as Artist;
      return {
        data: [artist],
        pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 },
      };
    }

    // slug 精確查詢
    if (params.slug) {
      const snapshot = await withTimeoutAndRetry(() =>
        this.artistsCollection!.where('slug', '==', params.slug).limit(1).get()
      );
      if (snapshot.empty) {
        return {
          data: [],
          pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 },
        };
      }
      const artist = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Artist;
      return {
        data: [artist],
        pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 },
      };
    }

    const { page, limit, skip } = this.resolvePagination(params);

    let baseQuery: FirebaseFirestore.Query = this.artistsCollection!;
    if (params.status) {
      baseQuery = baseQuery.where('status', '==', params.status);
    }

    const snapshot = await withTimeoutAndRetry(() => baseQuery.get());
    let artists = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Artist);

    if (params.search) {
      const term = params.search.toLowerCase();
      artists = artists.filter(
        a =>
          a.stageName?.toLowerCase().includes(term) ||
          (a.stageNameZh && a.stageNameZh.toLowerCase().includes(term)) ||
          (a.groupNames && a.groupNames.some(g => g.toLowerCase().includes(term))) ||
          (a.realName && a.realName.toLowerCase().includes(term))
      );
    }

    artists.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });

    const total = artists.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data: artists.slice(skip, skip + limit), pagination: { page, limit, total, totalPages } };
  }
}
