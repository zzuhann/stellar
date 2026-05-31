import { db, hasFirebaseConfig, withTimeoutAndRetry } from '../config/firebase';
import {
  CreateVenueData,
  UpdateVenueData,
  Venue,
  VenueBatchReviewItem,
  VenueBatchStatusItem,
  VenueDetail,
  VenueEventCard,
  VenueFilterParams,
  VenueStatus,
} from '../models/types';
import { cache } from '../utils/cache';
import {
  DocumentData,
  DocumentReference,
  FieldValue,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

// Normalize region: replace 臺 with 台 for consistency with Zod schema
const normalizeRegion = (region: string): string => region.replace(/臺/g, '台');

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
      region: normalizeRegion(d.region ?? ''),
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      nearestMrt: d.nearestMrt ?? '',
      mrtWalkMinutes: d.mrtWalkMinutes ?? null,
      capacityRange: d.capacityRange ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
      otherPhotos: d.otherPhotos ?? [],
      description: d.description ?? '',
      status: (d.status as VenueStatus) ?? 'pending',
      createdAt: d.createdAt ?? undefined,
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
        return snapshot.docs.map(doc => this.mapDocToVenue(doc));
      },
      1440
    );
  }

  async createVenue(data: CreateVenueData): Promise<VenueDetail> {
    this.checkFirebaseConfig();

    const docRef = this.collection.doc();
    const now = FieldValue.serverTimestamp();

    await withTimeoutAndRetry(() =>
      docRef.set({
        name: data.name,
        address: data.address,
        region: normalizeRegion(data.region),
        lat: data.lat ?? 0,
        lng: data.lng ?? 0,
        placeId: data.placeId ?? '',
        nearestMrt: data.nearestMrt ?? '',
        mrtWalkMinutes: data.mrtWalkMinutes ?? null,
        capacityRange: data.capacityRange ?? null,
        description: data.description ?? '',
        hostTags: data.hostTags ?? [],
        ...(data.preferredContact !== undefined ? { preferredContact: data.preferredContact } : {}),
        ...(data.contactUrl !== undefined ? { contactUrl: data.contactUrl } : {}),
        coverPhoto: data.coverPhoto ?? '',
        otherPhotos: data.otherPhotos ?? [],
        ...(data.socialMedia !== undefined ? { socialMedia: data.socialMedia } : {}),
        status: 'pending',
        eventCount: 0,
        eventRefs: [],
        createdAt: now,
        updatedAt: now,
      })
    );

    cache.delete('venues:all');

    return {
      id: docRef.id,
      name: data.name,
      address: data.address,
      region: normalizeRegion(data.region),
      lat: data.lat ?? 0,
      lng: data.lng ?? 0,
      placeId: data.placeId ?? '',
      nearestMrt: data.nearestMrt ?? '',
      mrtWalkMinutes: data.mrtWalkMinutes ?? null,
      capacityRange: data.capacityRange ?? null,
      description: data.description ?? '',
      hostTags: data.hostTags ?? [],
      preferredContact: data.preferredContact,
      contactUrl: data.contactUrl,
      coverPhoto: data.coverPhoto ?? '',
      otherPhotos: data.otherPhotos ?? [],
      socialMedia: data.socialMedia,
      status: 'pending',
      eventCount: 0,
      events: [],
    };
  }

  async getVenueById(id: string): Promise<VenueDetail | null> {
    this.checkFirebaseConfig();

    const cacheKey = `venue:detail:${id}`;
    const cached = cache.get<VenueDetail>(cacheKey);
    if (cached) return cached;

    const doc = await withTimeoutAndRetry(() => this.collection!.doc(id).get());
    if (!doc.exists) return null;

    const d = doc.data()!;
    // Only active venues are visible to the public
    if (d.status !== 'active') return null;

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
      region: normalizeRegion(d.region ?? ''),
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      placeId: d.placeId ?? '',
      nearestMrt: d.nearestMrt ?? '',
      mrtWalkMinutes: d.mrtWalkMinutes ?? null,
      capacityRange: d.capacityRange ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
      otherPhotos: d.otherPhotos ?? [],
      status: (d.status as VenueStatus) ?? 'pending',
      description: d.description ?? '',
      hostTags: d.hostTags ?? [],
      preferredContact: d.preferredContact ?? undefined,
      contactUrl: d.contactUrl ?? undefined,
      socialMedia: d.socialMedia ?? undefined,
      events,
    };

    cache.set(cacheKey, detail, 1440);
    return detail;
  }

  async updateVenue(id: string, data: UpdateVenueData): Promise<boolean> {
    this.checkFirebaseConfig();

    const docRef = this.collection!.doc(id);
    const existing = await withTimeoutAndRetry(() => docRef.get());
    if (!existing.exists) return false;

    const updatableFields: (keyof UpdateVenueData)[] = [
      'name',
      'address',
      'region',
      'status',
      'nearestMrt',
      'mrtWalkMinutes',
      'capacityRange',
      'description',
      'hostTags',
      'preferredContact',
      'contactUrl',
      'coverPhoto',
      'otherPhotos',
      'socialMedia',
    ];

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        updateData[field] = field === 'region' ? normalizeRegion(data[field] as string) : data[field];
      }
    }

    await withTimeoutAndRetry(() => docRef.update(updateData));

    cache.delete('venues:all');
    cache.delete(`venue:detail:${id}`);
    cache.delete(`venue:admin:detail:${id}`);

    return true;
  }

  async getAdminVenueById(id: string): Promise<VenueDetail | null> {
    this.checkFirebaseConfig();

    const cacheKey = `venue:admin:detail:${id}`;
    const cached = cache.get<VenueDetail>(cacheKey);
    if (cached) return cached;

    const doc = await withTimeoutAndRetry(() => this.collection!.doc(id).get());
    if (!doc.exists) return null;

    const d = doc.data()!;

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
      region: normalizeRegion(d.region ?? ''),
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      placeId: d.placeId ?? '',
      nearestMrt: d.nearestMrt ?? '',
      mrtWalkMinutes: d.mrtWalkMinutes ?? null,
      capacityRange: d.capacityRange ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
      otherPhotos: d.otherPhotos ?? [],
      status: (d.status as VenueStatus) ?? 'pending',
      description: d.description ?? '',
      hostTags: d.hostTags ?? [],
      preferredContact: d.preferredContact ?? undefined,
      contactUrl: d.contactUrl ?? undefined,
      socialMedia: d.socialMedia ?? undefined,
      events,
    };

    cache.set(cacheKey, detail, 1440);
    return detail;
  }

  async permanentDeleteVenue(id: string): Promise<'not_found' | 'has_events' | 'deleted'> {
    this.checkFirebaseConfig();

    const docRef = this.collection!.doc(id);
    const doc = await withTimeoutAndRetry(() => docRef.get());
    if (!doc.exists) return 'not_found';

    const d = doc.data()!;
    const eventRefs = (d.eventRefs ?? []) as DocumentReference[];
    if (eventRefs.length > 0) return 'has_events';

    await withTimeoutAndRetry(() => docRef.delete());

    cache.delete('venues:all');
    cache.delete(`venue:detail:${id}`);
    cache.delete(`venue:admin:detail:${id}`);

    return 'deleted';
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
    cache.delete(`venue:admin:detail:${id}`);

    return true;
  }

  /**
   * Called when a venue is approved. Backfills eventRefs on the venue
   * and venueId on all approved coffeeEvents sharing the same place_id.
   */
  private async onVenueApproved(venueId: string, placeId: string): Promise<void> {
    if (!hasFirebaseConfig || !db) return;

    const snapshot = await withTimeoutAndRetry(() =>
      db!
        .collection('coffeeEvents')
        .where('location.placeId', '==', placeId)
        .get()
    );

    const approvedEvents = snapshot.docs.filter(doc => doc.data().status === 'approved');

    for (const eventDoc of approvedEvents) {
      const eventId = eventDoc.id;
      const venueRef = db!.collection('venues').doc(venueId);

      await db!.runTransaction(async tx => {
        const venueDoc = await tx.get(venueRef);
        if (!venueDoc.exists) return;

        const existingRefs = venueDoc.data()?.eventRefs ?? [];
        const alreadyLinked = existingRefs.some((ref: DocumentReference) => ref.id === eventId);
        if (!alreadyLinked) {
          tx.update(venueRef, {
            eventRefs: FieldValue.arrayUnion(db!.collection('coffeeEvents').doc(eventId)),
            eventCount: FieldValue.increment(1),
          });
        }
        tx.update(db!.collection('coffeeEvents').doc(eventId), {
          'location.venueId': venueId,
        });
      });

      cache.delete(`venue:detail:${venueId}`);
    }

    cache.delete('venues:all');
  }

  /**
   * Batch review: transitions pending venues to active or rejected.
   * Only processes venues with status === 'pending'; others are skipped.
   * Returns the number of venues actually processed.
   */
  async batchReview(updates: VenueBatchReviewItem[]): Promise<number> {
    this.checkFirebaseConfig();

    let processed = 0;

    for (const { venueId, status } of updates) {
      const docRef = this.collection!.doc(venueId);
      const doc = await withTimeoutAndRetry(() => docRef.get());

      if (!doc.exists || doc.data()?.status !== 'pending') continue;

      await withTimeoutAndRetry(() =>
        docRef.update({ status, updatedAt: FieldValue.serverTimestamp() })
      );

      if (status === 'active') {
        const placeId: string = doc.data()?.placeId ?? '';
        if (placeId) {
          await this.onVenueApproved(venueId, placeId);
        }
        cache.delete(`venue:detail:${venueId}`);
        cache.delete(`venue:admin:detail:${venueId}`);
      } else {
        cache.delete(`venue:detail:${venueId}`);
        cache.delete(`venue:admin:detail:${venueId}`);
      }

      processed++;
    }

    cache.delete('venues:all');
    return processed;
  }

  /**
   * Batch status toggle: switches active venues to inactive or vice versa.
   * Only accepts 'active' or 'inactive'; other values are rejected upstream.
   * Returns the number of venues actually updated.
   */
  async batchStatus(updates: VenueBatchStatusItem[]): Promise<number> {
    this.checkFirebaseConfig();

    let processed = 0;

    for (const { venueId, status } of updates) {
      const docRef = this.collection!.doc(venueId);
      const doc = await withTimeoutAndRetry(() => docRef.get());

      if (!doc.exists) continue;

      await withTimeoutAndRetry(() =>
        docRef.update({ status, updatedAt: FieldValue.serverTimestamp() })
      );

      cache.delete(`venue:detail:${venueId}`);
      cache.delete(`venue:admin:detail:${venueId}`);
      processed++;
    }

    cache.delete('venues:all');
    return processed;
  }

  async getVenues(params: VenueFilterParams): Promise<Venue[]> {
    const { region, capacityRange, sort, status } = params;

    let venues = await this.fetchAll();

    if (status !== 'all') {
      venues = venues.filter(v => v.status === (status ?? 'active'));
    }

    if (region && region.length > 0) {
      const normalizedRegions = region.map(normalizeRegion);
      venues = venues.filter(v => normalizedRegions.includes(v.region));
    }

    if (capacityRange !== undefined) {
      venues = venues.filter(v => v.capacityRange === capacityRange);
    }

    if (sort === 'name') {
      venues = [...venues].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    } else if (sort === 'newest') {
      venues = [...venues].sort((a, b) => {
        const aMs = a.createdAt?.toMillis() ?? 0;
        const bMs = b.createdAt?.toMillis() ?? 0;
        return bMs - aMs;
      });
    }

    return venues;
  }
}
