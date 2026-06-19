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

  private resolvePagination(params: AdminQueryParams): { page: number; limit: number; skip: number } {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(Math.max(1, params.limit ?? 20), 50);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
  }

  async getAdminEvents(params: AdminQueryParams): Promise<AdminPaginatedResponse<CoffeeEvent>> {
    this.checkFirebaseConfig();

    // id 精確查詢，優先處理
    if (params.id) {
      const doc = await withTimeoutAndRetry(() =>
        this.eventsCollection!.doc(params.id!).get()
      );
      if (!doc.exists) {
        return { data: [], pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 } };
      }
      const event = { id: doc.id, ...doc.data() } as CoffeeEvent;
      return { data: [event], pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 } };
    }

    // slug 精確查詢
    if (params.slug) {
      const snapshot = await withTimeoutAndRetry(() =>
        this.eventsCollection!.where('slug', '==', params.slug).limit(1).get()
      );
      if (snapshot.empty) {
        return { data: [], pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 } };
      }
      const event = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as CoffeeEvent;
      return { data: [event], pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 } };
    }

    // 一般查詢：按狀態篩選後在記憶體中排序分頁
    let snapshot;
    if (params.status) {
      snapshot = await withTimeoutAndRetry(() =>
        this.eventsCollection!.where('status', '==', params.status).get()
      );
    } else {
      snapshot = await withTimeoutAndRetry(() => this.eventsCollection!.get());
    }

    let events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CoffeeEvent);

    // search 模糊篩選（title）
    if (params.search) {
      const term = params.search.toLowerCase();
      events = events.filter(e => e.title.toLowerCase().includes(term));
    }

    // 按 createdAt 由新到舊排序
    events.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

    const { page, limit, skip } = this.resolvePagination(params);
    const total = events.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = events.slice(skip, skip + limit);

    return { data, pagination: { page, limit, total, totalPages } };
  }

  async getAdminArtists(params: AdminQueryParams): Promise<AdminPaginatedResponse<Artist>> {
    this.checkFirebaseConfig();

    // id 精確查詢，優先處理
    if (params.id) {
      const doc = await withTimeoutAndRetry(() =>
        this.artistsCollection!.doc(params.id!).get()
      );
      if (!doc.exists) {
        return { data: [], pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 } };
      }
      const artist = { id: doc.id, ...doc.data() } as Artist;
      return { data: [artist], pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 } };
    }

    // slug 精確查詢
    if (params.slug) {
      const snapshot = await withTimeoutAndRetry(() =>
        this.artistsCollection!.where('slug', '==', params.slug).limit(1).get()
      );
      if (snapshot.empty) {
        return { data: [], pagination: { page: 1, limit: params.limit ?? 20, total: 0, totalPages: 0 } };
      }
      const artist = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Artist;
      return { data: [artist], pagination: { page: 1, limit: params.limit ?? 20, total: 1, totalPages: 1 } };
    }

    // 一般查詢
    let snapshot;
    if (params.status) {
      snapshot = await withTimeoutAndRetry(() =>
        this.artistsCollection!.where('status', '==', params.status).get()
      );
    } else {
      snapshot = await withTimeoutAndRetry(() => this.artistsCollection!.get());
    }

    let artists = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Artist);

    // search 模糊篩選（stageName、stageNameZh、groupNames、realName）
    if (params.search) {
      const term = params.search.toLowerCase();
      artists = artists.filter(a =>
        a.stageName.toLowerCase().includes(term) ||
        (a.stageNameZh && a.stageNameZh.toLowerCase().includes(term)) ||
        (a.groupNames && a.groupNames.some(g => g.toLowerCase().includes(term))) ||
        (a.realName && a.realName.toLowerCase().includes(term))
      );
    }

    // 按 createdAt 由新到舊排序
    artists.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

    const { page, limit, skip } = this.resolvePagination(params);
    const total = artists.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = artists.slice(skip, skip + limit);

    return { data, pagination: { page, limit, total, totalPages } };
  }
}
