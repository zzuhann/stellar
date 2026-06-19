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

    // 有 search：需要 JS filter，先拉有限資料集再過濾
    if (params.search) {
      let baseQuery: FirebaseFirestore.Query = this.eventsCollection!;
      if (params.status) {
        baseQuery = baseQuery.where('status', '==', params.status);
      }
      const snapshot = await withTimeoutAndRetry(() => baseQuery.orderBy('createdAt', 'desc').get());
      let events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CoffeeEvent);

      const term = params.search.toLowerCase();
      events = events.filter(e => e.title?.toLowerCase().includes(term));

      const total = events.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      return { data: events.slice(skip, skip + limit), pagination: { page, limit, total, totalPages } };
    }

    // 無 search：Firestore 原生分頁，只拉需要的筆數
    let baseQuery: FirebaseFirestore.Query = this.eventsCollection!;
    if (params.status) {
      baseQuery = baseQuery.where('status', '==', params.status);
    }

    const [countSnap, dataSnap] = await Promise.all([
      withTimeoutAndRetry(() => baseQuery.count().get()),
      withTimeoutAndRetry(() => baseQuery.orderBy('createdAt', 'desc').offset(skip).limit(limit).get()),
    ]);

    const total = countSnap.data().count;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = dataSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CoffeeEvent);

    return { data, pagination: { page, limit, total, totalPages } };
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

    // 有 search：需要 JS filter，先拉有限資料集再過濾
    if (params.search) {
      let baseQuery: FirebaseFirestore.Query = this.artistsCollection!;
      if (params.status) {
        baseQuery = baseQuery.where('status', '==', params.status);
      }
      const snapshot = await withTimeoutAndRetry(() => baseQuery.orderBy('createdAt', 'desc').get());
      let artists = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Artist);

      const term = params.search.toLowerCase();
      artists = artists.filter(
        a =>
          a.stageName?.toLowerCase().includes(term) ||
          (a.stageNameZh && a.stageNameZh.toLowerCase().includes(term)) ||
          (a.groupNames && a.groupNames.some(g => g.toLowerCase().includes(term))) ||
          (a.realName && a.realName.toLowerCase().includes(term))
      );

      const total = artists.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      return { data: artists.slice(skip, skip + limit), pagination: { page, limit, total, totalPages } };
    }

    // 無 search：Firestore 原生分頁
    let baseQuery: FirebaseFirestore.Query = this.artistsCollection!;
    if (params.status) {
      baseQuery = baseQuery.where('status', '==', params.status);
    }

    const [countSnap, dataSnap] = await Promise.all([
      withTimeoutAndRetry(() => baseQuery.count().get()),
      withTimeoutAndRetry(() => baseQuery.orderBy('createdAt', 'desc').offset(skip).limit(limit).get()),
    ]);

    const total = countSnap.data().count;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = dataSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Artist);

    return { data, pagination: { page, limit, total, totalPages } };
  }
}
