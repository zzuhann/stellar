import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import {
  UpdateVenueData,
  Venue,
  VenueDetail,
  VenueEventCard,
  VenueFilterParams,
} from '../models/types';
import { cache } from '../utils/cache';
import {
  DocumentData,
  DocumentReference,
  FieldValue,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

export class VenueService {
  private collection = hasFirebaseConfig && db ? db.collection('venues') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new Error('Firebase 問題，請檢查環境變數');
    }
  }

  private mapDocToVenue(doc: QueryDocumentSnapshot<DocumentData>): Venue {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.name ?? '',
      address: d.address ?? '',
      region: d.region ?? '',
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      nearest_mrt: d.nearest_mrt ?? '',
      mrt_walk_minutes: d.mrt_walk_minutes ?? null,
      capacity_max: d.capacity_max ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
      status: (d.status as 'active' | 'inactive') ?? 'active',
      socialMedia: d.socialMedia ?? undefined,
    };
  }

  private async fetchAll(): Promise<Venue[]> {
    this.checkFirebaseConfig();
    return cache.getWithLock(
      'venues:all',
      async () => {
        const snapshot = await withTimeoutAndRetry(() =>
          this.collection!.orderBy('eventCount', 'desc').get()
        );
        return snapshot.docs
          .filter(doc => doc.data().status !== 'inactive')
          .map(doc => this.mapDocToVenue(doc));
      },
      1440
    );
  }

  async getVenueById(id: string): Promise<VenueDetail | null> {
    this.checkFirebaseConfig();

    const cacheKey = `venue:detail:${id}`;
    const cached = cache.get<VenueDetail>(cacheKey);
    if (cached) return cached;

    const doc = await withTimeoutAndRetry(() => this.collection!.doc(id).get());
    if (!doc.exists) return null;

    const d = doc.data()!;
    if (d.status === 'inactive') return null;

    const eventRefs = (d.eventRefs ?? []) as DocumentReference[];

    let events: VenueEventCard[] = [];

    if (eventRefs.length > 0) {
      const eventDocs = await withTimeoutAndRetry(() => db!.getAll(...eventRefs));

      events = eventDocs
        .filter(ev => ev.exists && ev.data()?.status === 'approved')
        .map(ev => {
          const e = ev.data()!;
          const artists = (e.artists ?? []) as Array<{ name: string }>;
          const start = e.datetime?.start as Timestamp | undefined;
          const end = e.datetime?.end as Timestamp | undefined;
          return {
            id: ev.id,
            title: e.title ?? '',
            artistName: artists.map(a => a.name).join(' x '),
            startDate: start?.toDate().toISOString() ?? '',
            endDate: end?.toDate().toISOString() ?? '',
            coverImage: e.mainImage ?? '',
            slug: (e.slug as string | null | undefined) ?? null,
          };
        })
        .sort((a, b) => (b.startDate > a.startDate ? 1 : b.startDate < a.startDate ? -1 : 0));
    }

    const detail: VenueDetail = {
      id: doc.id,
      name: d.name ?? '',
      address: d.address ?? '',
      region: d.region ?? '',
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      place_id: d.place_id ?? '',
      nearest_mrt: d.nearest_mrt ?? '',
      mrt_walk_minutes: d.mrt_walk_minutes ?? null,
      capacity_max: d.capacity_max ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
      status: (d.status as 'active' | 'inactive' | undefined) ?? 'active',
      equipment: d.equipment ?? [],
      decoration_allowed: d.decoration_allowed ?? [],
      custom_items: d.custom_items ?? [],
      price_model: d.price_model ?? '',
      price_note: d.price_note ?? '',
      cancel_policy: d.cancel_policy ?? '',
      noise_ok: d.noise_ok ?? null,
      venue_visit_ok: d.venue_visit_ok ?? null,
      host_tags: d.host_tags ?? [],
      socialMedia: d.socialMedia ?? undefined,
      events,
    };

    cache.set(cacheKey, detail, 1440);
    return detail;
  }

  async updateVenue(id: string, data: UpdateVenueData): Promise<VenueDetail | null> {
    this.checkFirebaseConfig();

    const docRef = this.collection!.doc(id);
    const existing = await withTimeoutAndRetry(() => docRef.get());
    if (!existing.exists) return null;

    const updatableFields: (keyof UpdateVenueData)[] = [
      'name',
      'address',
      'region',
      'status',
      'nearest_mrt',
      'mrt_walk_minutes',
      'capacity_max',
      'equipment',
      'decoration_allowed',
      'custom_items',
      'price_model',
      'price_note',
      'venue_visit_ok',
      'cancel_policy',
      'noise_ok',
      'host_tags',
      'coverPhoto',
      'socialMedia',
    ];

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    await withTimeoutAndRetry(() => docRef.update(updateData));

    cache.delete('venues:all');
    cache.delete(`venue:detail:${id}`);

    return this.getVenueById(id);
  }

  async deactivateVenue(id: string): Promise<boolean> {
    this.checkFirebaseConfig();

    const docRef = this.collection!.doc(id);
    const existing = await withTimeoutAndRetry(() => docRef.get());
    if (!existing.exists || existing.data()?.status === 'inactive') return false;

    await withTimeoutAndRetry(() =>
      docRef.update({
        status: 'inactive',
        updatedAt: FieldValue.serverTimestamp(),
      })
    );

    cache.delete('venues:all');
    cache.delete(`venue:detail:${id}`);

    return true;
  }

  async getVenues(params: VenueFilterParams): Promise<Venue[]> {
    const { region, capacity_min, capacity_max, sort } = params;

    let venues = await this.fetchAll();

    if (region && region.length > 0) {
      venues = venues.filter(v => region.includes(v.region));
    }

    if (capacity_min !== undefined) {
      venues = venues.filter(v => v.capacity_max !== null && v.capacity_max >= capacity_min);
    }

    if (capacity_max !== undefined) {
      venues = venues.filter(v => v.capacity_max !== null && v.capacity_max <= capacity_max);
    }

    if (sort === 'name') {
      venues = [...venues].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    }

    return venues;
  }
}
