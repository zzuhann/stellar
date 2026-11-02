import { db, hasFirebaseConfig } from '../config/firebase';
import { withTimeoutAndRetry } from '../utils/firestoreTimeout';
import { AppError } from '../utils/AppError';
import {
  AdminVenueDetail,
  CreateVenueData,
  CreateVenueSubmissionData,
  PaginatedVenues,
  UpdateVenueData,
  Venue,
  VenueBatchReviewItem,
  VenueBatchStatusItem,
  VenueDetail,
  VenueEventCardBase,
  VenueFilterParams,
  VenueStatus,
  VenueSubmissionRecord,
  VenueWithScore,
} from '../models/types';
import { cache } from '../utils/cache';
import { syncEventVenue } from './eventVenueSync';
import { getIsoWeekString } from '../utils/isoWeek';
import { filterOutCorruptedDatetime } from '../utils/eventSanitizer';
import { haversineDistanceMeters, isMissingVenueCoords, toValidVenueCoords } from '../utils/geo';
import { getTaipeiDateString } from '../utils/taipeiDate';
import { computeEventTimeStatus, filterVisibleTags, mapAnswersToSuggestedTags } from './venueTags';
import { pickLegacyTransit } from './venueTransit';
import {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

// Normalize region: replace 臺 with 台 for consistency with Zod schema
const normalizeRegion = (region: string): string => region.replace(/臺/g, '台');

// Normalize for fuzzy name search: lowercase, strip everything except letters/numbers
// (keeps CJK chars), so "ABC Mart" matches "abcmart" and "S.Coups" matches "scoups".
const normalizeSearchText = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const VIEW_WINDOW_DAYS = 90;

// Composite sort scoring constants — see specs/features/venues/design-backend.md
// Phase 2.8「分數正規化」段落。
export const ACTIVE_WEEKS_WINDOW = 26;
export const VIEW_CAP_FLOOR = 30; // viewCap 下限，避免資料少時 P90 過小讓大家輕易拿滿分
export const VIEW_CAP_PERCENTILE = 0.9;
export const NEW_VENUE_PROTECTION_WEEKS = 8;
export const NEW_VENUE_DECAY_WEEKS = 2; // 保護期最後兩週線性降到 0

const WEIGHT_ACTIVE_WEEKS = 0.45;
const WEIGHT_VIEWS = 0.3;
const WEIGHT_NEW_VENUE = 0.25;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const computeActiveWeeksScore = (activeWeeks: number): number =>
  Math.min(activeWeeks, ACTIVE_WEEKS_WINDOW) / ACTIVE_WEEKS_WINDOW;

// 用 P90 而非最大值，爆紅場地只拿滿分、不會拉高上限壓縮其他場地
export const computeViewCap = (recentViewsAll: number[]): number => {
  if (recentViewsAll.length === 0) return VIEW_CAP_FLOOR;
  const sorted = [...recentViewsAll].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(VIEW_CAP_PERCENTILE * sorted.length)];
  return Math.max(VIEW_CAP_FLOOR, p90);
};

export const computeViewScore = (recentViews: number, viewCap: number): number =>
  Math.min(recentViews, viewCap) / viewCap;

// 未滿 6 週（8-2）滿分 1；6-8 週線性降到 0；超過 8 週（含）為 0
export const computeNewVenueScore = (weeksSinceCreated: number): number =>
  clamp((NEW_VENUE_PROTECTION_WEEKS - weeksSinceCreated) / NEW_VENUE_DECAY_WEEKS, 0, 1);

export const computeCompositeScore = (
  activeWeeks: number,
  recentViews: number,
  weeksSinceCreated: number,
  viewCap: number
): number =>
  computeActiveWeeksScore(activeWeeks) * WEIGHT_ACTIVE_WEEKS +
  computeViewScore(recentViews, viewCap) * WEIGHT_VIEWS +
  computeNewVenueScore(weeksSinceCreated) * WEIGHT_NEW_VENUE;

/**
 * For each venue, counts distinct ISO weeks (UTC) among its approved events whose
 * datetime.start falls within the last ACTIVE_WEEKS_WINDOW weeks. Events that are
 * missing (deleted doc), not approved, or outside the window are silently skipped.
 */
export function computeActiveWeeks(
  refsByVenue: Map<string, DocumentReference[]>,
  eventDocs: DocumentSnapshot<DocumentData>[]
): Map<string, number> {
  const eventById = new Map<string, DocumentSnapshot<DocumentData>>();
  eventDocs.forEach(doc => eventById.set(doc.id, doc));

  const cutoffMs = Date.now() - ACTIVE_WEEKS_WINDOW * MS_PER_WEEK;
  const result = new Map<string, number>();

  refsByVenue.forEach((refs, venueId) => {
    const weeks = new Set<string>();

    for (const ref of refs) {
      const doc = eventById.get(ref.id);
      if (!doc || !doc.exists) continue;

      const data = doc.data();
      if (!data || data.status !== 'approved') continue;

      const start = data.datetime?.start as Timestamp | undefined;
      // Negated > also skips a corrupted start (not a Timestamp, or NaN millis).
      if (typeof start?.toMillis !== 'function' || !(start.toMillis() > cutoffMs)) continue;

      weeks.add(getIsoWeekString(start.toDate()));
    }

    result.set(venueId, weeks.size);
  });

  return result;
}

const formatUtcDate = (date: Date): string => date.toISOString().slice(0, 10);

// Cached detail shape: raw tags, events without timeStatus (both resolved per request)
type CachedVenueDetail = Omit<VenueDetail, 'events'> & { events: VenueEventCardBase[] };
type CachedAdminVenueDetail = Omit<AdminVenueDetail, 'events'> & { events: VenueEventCardBase[] };

// Returns a new object: cached venues must keep raw tags
const toPublicVenue = (v: VenueWithScore, today: string): Venue => {
  const rest: Partial<VenueWithScore> = { ...v, tags: filterVisibleTags(v.tags, today) };
  delete rest.compositeScore;
  return rest as Venue;
};

const withTimeStatus = <T extends { events: VenueEventCardBase[] }>(detail: T, today: string) => ({
  ...detail,
  events: detail.events.map(e => ({
    ...e,
    timeStatus: computeEventTimeStatus(e.startDate, e.endDate, today),
  })),
});

// compositeScore desc → createdAt desc → id asc，確保排序具決定性（deterministic）。
// 抽出自既有 composite 排序分支，與 sort=distance 的 tie-break 共用，避免重複程式碼。
const compositeTieBreak = (a: VenueWithScore, b: VenueWithScore): number => {
  const scoreDiff = (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  const aMs = a.createdAt?.toMillis() ?? 0;
  const bMs = b.createdAt?.toMillis() ?? 0;
  if (aMs !== bMs) return bMs - aMs; // createdAt desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // 最終防線：確保排序具決定性
};

export class VenueService {
  private collection = hasFirebaseConfig && db ? db.collection('venues') : null;

  private checkFirebaseConfig() {
    if (!hasFirebaseConfig || !this.collection) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Firebase 問題，請檢查環境變數');
    }
  }

  private mapDocToVenue(doc: QueryDocumentSnapshot<DocumentData>): Venue {
    const d = doc.data();
    // 任一邊缺值（null/undefined/字串/NaN）→ 兩邊都設為 0，與 isMissingVenueCoords
    // 的「兩者同時為 0 視為缺座標」判定一致，避免單側缺值被誤判成有效座標。
    // 見 src/utils/geo.ts 的 toValidVenueCoords。
    const { lat, lng } = toValidVenueCoords(d.lat, d.lng);
    return {
      id: doc.id,
      name: d.name ?? '',
      address: d.address ?? '',
      region: normalizeRegion(d.region ?? ''),
      lat,
      lng,
      nearestMrt: d.nearestMrt ?? '',
      mrtWalkMinutes: d.mrtWalkMinutes ?? null,
      capacityRange: d.capacityRange ?? null,
      eventCount: d.eventCount ?? 0,
      coverPhoto: d.coverPhoto ?? '',
      otherPhotos: d.otherPhotos ?? [],
      description: d.description ?? '',
      hostTags: d.hostTags ?? [],
      tags: d.tags ?? [],
      status: (d.status as VenueStatus) ?? 'pending',
      createdAt: d.createdAt ?? undefined,
      updatedAt: d.updatedAt ?? undefined,
      socialMedia: d.socialMedia ?? undefined,
    };
  }

  private async fetchAll(): Promise<VenueWithScore[]> {
    this.checkFirebaseConfig();
    return cache.getWithLock(
      'venues:all',
      async () => {
        const snapshot = await withTimeoutAndRetry(() =>
          this.collection!.orderBy('eventCount', 'desc').get()
        );
        const venues = snapshot.docs.map(doc => this.mapDocToVenue(doc));

        // Flatten every venue's eventRefs into a single batch get, instead of
        // querying per-venue (N+1). See design-backend.md「活躍週數計算：避免 N+1」。
        const refsByVenue = new Map<string, DocumentReference[]>();
        const allRefs: DocumentReference[] = [];
        snapshot.docs.forEach(doc => {
          const refs = (doc.data().eventRefs ?? []) as DocumentReference[];
          refsByVenue.set(doc.id, refs);
          allRefs.push(...refs);
        });

        const [eventDocs, viewsByVenue] = await Promise.all([
          allRefs.length > 0
            ? withTimeoutAndRetry(() => db!.getAll(...allRefs))
            : Promise.resolve([] as DocumentSnapshot<DocumentData>[]),
          this.fetchRecentViewsByVenue(),
        ]);

        const activeWeeksByVenue = computeActiveWeeks(refsByVenue, eventDocs);

        // 母體只含 active 場地（無 bucket 補 0），已刪除場地的殘留 bucket 不計
        const viewCap = computeViewCap(
          venues.filter(v => v.status === 'active').map(v => viewsByVenue.get(v.id) ?? 0)
        );

        return venues.map(venue => {
          const activeWeeks = activeWeeksByVenue.get(venue.id) ?? 0;
          const recentViews = viewsByVenue.get(venue.id) ?? 0;
          const createdAtMs = venue.createdAt?.toMillis() ?? 0;
          const weeksSinceCreated =
            createdAtMs > 0 ? (Date.now() - createdAtMs) / MS_PER_WEEK : Infinity;

          return {
            ...venue,
            compositeScore: computeCompositeScore(
              activeWeeks,
              recentViews,
              weeksSinceCreated,
              viewCap
            ),
          };
        });
      },
      1440
    );
  }

  /**
   * Single range query over venueViewDaily for the last VIEW_WINDOW_DAYS days,
   * aggregated in memory by venueId. Not per-venue — see design-backend.md
   * 「瀏覽數滾動窗口計算」。Cold start (empty collection) resolves to an empty map,
   * which callers treat as 0 views per venue — never falls back to viewCount.
   */
  private async fetchRecentViewsByVenue(): Promise<Map<string, number>> {
    const cutoffDateStr = formatUtcDate(
      new Date(Date.now() - VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    );
    const viewSnapshot = await withTimeoutAndRetry(() =>
      db!.collection('venueViewDaily').where('date', '>=', cutoffDateStr).get()
    );

    const viewsByVenue = new Map<string, number>();
    viewSnapshot.docs.forEach(doc => {
      const d = doc.data();
      viewsByVenue.set(d.venueId, (viewsByVenue.get(d.venueId) ?? 0) + (d.count ?? 0));
    });
    return viewsByVenue;
  }

  async createVenue(data: CreateVenueData): Promise<VenueDetail> {
    return this.writeNewVenue(data);
  }

  // Public submission path: curated fields are never written, even if a caller passes them.
  // Questionnaire answers become suggestions in `submission`, confirmed later by an admin.
  async createVenueSubmission(data: CreateVenueSubmissionData): Promise<VenueDetail> {
    const { venueConditions, ...rest } = data;
    // calendarUrl lives only in the formal field, so no stale copy can be prefilled later
    const { calendarUrl, ...answers } = venueConditions ?? {};
    const submission = venueConditions && {
      submittedAt: FieldValue.serverTimestamp(),
      answers,
      suggestedTags: mapAnswersToSuggestedTags(venueConditions, {
        transitStops: data.transitStops,
      }),
      confirmedAt: null,
    };
    return this.writeNewVenue(
      {
        ...rest,
        tags: undefined,
        sourceLinks: undefined,
        equipmentNote: undefined,
        infoUpdatedOn: undefined,
        // Private and needs no confirmation, so it goes straight to the real field (§3.1)
        calendarUrl: calendarUrl ?? undefined,
      },
      submission
    );
  }

  private async writeNewVenue(
    data: CreateVenueData,
    submission?: Record<string, unknown>
  ): Promise<VenueDetail> {
    this.checkFirebaseConfig();

    const docRef = this.collection.doc();
    const now = FieldValue.serverTimestamp();
    // When transitStops is sent, it is the source of truth for the legacy fields (§10.3)
    const legacyTransit =
      data.transitStops !== undefined
        ? pickLegacyTransit(data.transitStops)
        : { nearestMrt: data.nearestMrt ?? '', mrtWalkMinutes: data.mrtWalkMinutes ?? null };

    await withTimeoutAndRetry(() =>
      docRef.set({
        name: data.name,
        address: data.address,
        region: normalizeRegion(data.region),
        lat: data.lat ?? 0,
        lng: data.lng ?? 0,
        placeId: data.placeId ?? '',
        ...legacyTransit,
        ...(data.transitStops !== undefined ? { transitStops: data.transitStops } : {}),
        capacityRange: data.capacityRange,
        description: data.description ?? '',
        hostTags: data.hostTags ?? [],
        preferredContact: data.preferredContact,
        ...(data.contactUrl !== undefined ? { contactUrl: data.contactUrl } : {}),
        bookingFormUrl: data.bookingFormUrl ?? null,
        coverPhoto: data.coverPhoto,
        otherPhotos: data.otherPhotos ?? [],
        socialMedia: data.socialMedia,
        tags: data.tags ?? [],
        sourceLinks: data.sourceLinks ?? [],
        equipmentNote: data.equipmentNote ?? '',
        infoUpdatedOn: data.infoUpdatedOn ?? null,
        calendarUrl: data.calendarUrl ?? null,
        ...(submission ? { submission } : {}),
        status: 'pending',
        eventCount: 0,
        eventRefs: [],
        createdAt: now,
        updatedAt: now,
      })
    );

    cache.clearPattern('admin:venues:');

    return {
      id: docRef.id,
      name: data.name,
      address: data.address,
      region: normalizeRegion(data.region),
      lat: data.lat ?? 0,
      lng: data.lng ?? 0,
      placeId: data.placeId ?? '',
      ...legacyTransit,
      transitStops: data.transitStops ?? null,
      capacityRange: data.capacityRange,
      description: data.description ?? '',
      hostTags: data.hostTags ?? [],
      preferredContact: data.preferredContact,
      contactUrl: data.contactUrl,
      bookingFormUrl: data.bookingFormUrl ?? null,
      coverPhoto: data.coverPhoto,
      otherPhotos: data.otherPhotos ?? [],
      socialMedia: data.socialMedia,
      tags: data.tags ?? [],
      sourceLinks: data.sourceLinks ?? [],
      equipmentNote: data.equipmentNote ?? '',
      infoUpdatedOn: data.infoUpdatedOn ?? null,
      status: 'pending',
      eventCount: 0,
      events: [],
    };
  }

  async getVenueById(id: string): Promise<VenueDetail | null> {
    const detail = await this.getCachedVenueDetail(id);
    if (!detail) return null;
    const today = getTaipeiDateString(new Date());
    return withTimeStatus({ ...detail, tags: filterVisibleTags(detail.tags, today) }, today);
  }

  private async getCachedVenueDetail(id: string): Promise<CachedVenueDetail | null> {
    this.checkFirebaseConfig();

    const cacheKey = `venue:detail:${id}`;
    const cacheVersion = cache.version();
    const cached = cache.get<CachedVenueDetail>(cacheKey);
    if (cached) return cached;

    const doc = await withTimeoutAndRetry(() => this.collection!.doc(id).get());
    if (!doc.exists) return null;

    const d = doc.data()!;
    // Only active venues are visible to the public
    if (d.status !== 'active') return null;

    const eventRefs = (d.eventRefs ?? []) as DocumentReference[];

    let events: VenueEventCardBase[] = [];

    if (eventRefs.length > 0) {
      const eventDocs = await withTimeoutAndRetry(() => db!.getAll(...eventRefs));

      events = filterOutCorruptedDatetime(
        eventDocs
          .filter(ev => ev.exists && ev.data()?.status === 'approved')
          .map(ev => ({ ...ev.data(), id: ev.id }) as DocumentData & { id: string })
      )
        .map(e => {
          const artists = (e.artists ?? []) as Array<{ name: string }>;
          const start = e.datetime.start as Timestamp;
          const end = e.datetime.end as Timestamp;
          return {
            id: e.id,
            title: e.title ?? '',
            artistName: artists.map(a => a.name).join(' x '),
            startDate: start.toDate().toISOString(),
            endDate: end.toDate().toISOString(),
            coverImage: e.mainImage ?? '',
            slug: (e.slug as string | null | undefined) ?? null,
          };
        })
        .sort((a, b) => (b.startDate > a.startDate ? 1 : b.startDate < a.startDate ? -1 : 0));
    }

    const detail: CachedVenueDetail = {
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
      tags: d.tags ?? [],
      sourceLinks: d.sourceLinks ?? [],
      equipmentNote: d.equipmentNote ?? '',
      infoUpdatedOn: d.infoUpdatedOn ?? null,
      preferredContact: d.preferredContact ?? undefined,
      contactUrl: d.contactUrl ?? undefined,
      bookingFormUrl: d.bookingFormUrl ?? null,
      transitStops: d.transitStops ?? null,
      socialMedia: d.socialMedia ?? undefined,
      updatedAt: d.updatedAt ?? undefined,
      events,
    };

    cache.set(cacheKey, detail, 1440, cacheVersion);
    return detail;
  }

  async incrementViewCount(id: string): Promise<void> {
    this.checkFirebaseConfig();
    // 既有行為：累計總數（保留，非本次範圍，未來若確認無用途再另案移除）
    await this.collection.doc(id).update({
      viewCount: FieldValue.increment(1),
    });

    // 新增：寫入當日 bucket，供近 90 天滾動窗口聚合使用。set(..., { merge: true }) 搭配
    // FieldValue.increment 是 atomic write：doc 不存在時建立並設為 1，存在時原子遞增，
    // 不會有 read-then-write race condition。dedup 在 controller 層完成（見
    // venueController.ts 的 venue_view_dedup cache key），這裡不重複處理。
    const dateStr = formatUtcDate(new Date());
    const bucketRef = db!.collection('venueViewDaily').doc(`${id}_${dateStr}`);
    await bucketRef.set(
      {
        venueId: id,
        date: dateStr,
        count: FieldValue.increment(1),
        expireAt: Timestamp.fromMillis(Date.now() + VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      },
      { merge: true }
    );
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
      'bookingFormUrl',
      'coverPhoto',
      'otherPhotos',
      'socialMedia',
      'tags',
      'sourceLinks',
      'equipmentNote',
      'infoUpdatedOn',
      'calendarUrl',
    ];

    const updateData: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        updateData[field] =
          field === 'region' ? normalizeRegion(data[field] as string) : data[field];
      }
    }

    if (data.transitStops !== undefined) {
      const stops = data.transitStops ?? [];
      updateData.transitStops = stops;
      Object.assign(updateData, pickLegacyTransit(stops));
    }

    // Decided on the doc just read, not the admin cache, so a stale cache can't re-confirm.
    // ponytail: read-then-update isn't atomic; fine with one admin, use runTransaction if several
    const submission = existing.data()?.submission as { confirmedAt?: unknown } | undefined;
    if (data.confirmSuggestions === true && submission && submission.confirmedAt === null) {
      updateData['submission.confirmedAt'] = FieldValue.serverTimestamp();
    }

    await withTimeoutAndRetry(() => docRef.update(updateData));

    cache.delete('venues:all');
    cache.delete(`venue:detail:${id}`);
    cache.delete(`venue:admin:detail:${id}`);
    cache.clearPattern('admin:venues:');

    return true;
  }

  // Admin sees raw tags (incl. expired) so the editor can flag them
  async getAdminVenueById(id: string): Promise<AdminVenueDetail | null> {
    const detail = await this.getCachedAdminVenueDetail(id);
    return detail && withTimeStatus(detail, getTaipeiDateString(new Date()));
  }

  private async getCachedAdminVenueDetail(id: string): Promise<CachedAdminVenueDetail | null> {
    this.checkFirebaseConfig();

    const cacheKey = `venue:admin:detail:${id}`;
    const cacheVersion = cache.version();
    const cached = cache.get<CachedAdminVenueDetail>(cacheKey);
    if (cached) return cached;

    const doc = await withTimeoutAndRetry(() => this.collection!.doc(id).get());
    if (!doc.exists) return null;

    const d = doc.data()!;

    const eventRefs = (d.eventRefs ?? []) as DocumentReference[];

    let events: VenueEventCardBase[] = [];

    if (eventRefs.length > 0) {
      const eventDocs = await withTimeoutAndRetry(() => db!.getAll(...eventRefs));

      events = filterOutCorruptedDatetime(
        eventDocs
          .filter(ev => ev.exists && ev.data()?.status === 'approved')
          .map(ev => ({ ...ev.data(), id: ev.id }) as DocumentData & { id: string })
      )
        .map(e => {
          const artists = (e.artists ?? []) as Array<{ name: string }>;
          const start = e.datetime.start as Timestamp;
          const end = e.datetime.end as Timestamp;
          return {
            id: e.id,
            title: e.title ?? '',
            artistName: artists.map(a => a.name).join(' x '),
            startDate: start.toDate().toISOString(),
            endDate: end.toDate().toISOString(),
            coverImage: e.mainImage ?? '',
            slug: (e.slug as string | null | undefined) ?? null,
          };
        })
        .sort((a, b) => (b.startDate > a.startDate ? 1 : b.startDate < a.startDate ? -1 : 0));
    }

    const detail: CachedAdminVenueDetail = {
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
      tags: d.tags ?? [],
      sourceLinks: d.sourceLinks ?? [],
      equipmentNote: d.equipmentNote ?? '',
      infoUpdatedOn: d.infoUpdatedOn ?? null,
      calendarUrl: d.calendarUrl ?? null,
      preferredContact: d.preferredContact ?? undefined,
      contactUrl: d.contactUrl ?? undefined,
      bookingFormUrl: d.bookingFormUrl ?? null,
      transitStops: d.transitStops ?? null,
      socialMedia: d.socialMedia ?? undefined,
      updatedAt: d.updatedAt ?? undefined,
      ...(d.submission ? { submission: d.submission as VenueSubmissionRecord } : {}),
      events,
    };

    cache.set(cacheKey, detail, 1440, cacheVersion);
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
    cache.clearPattern('admin:venues:');

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
    cache.clearPattern('admin:venues:');

    return true;
  }

  /**
   * Called when a venue is approved. Backfills eventRefs on the venue
   * and venueId on all approved coffeeEvents sharing the same place_id.
   */
  private async onVenueApproved(venueId: string, placeId: string): Promise<void> {
    if (!hasFirebaseConfig || !db) return;

    const snapshot = await withTimeoutAndRetry(() =>
      db!.collection('coffeeEvents').where('location.placeId', '==', placeId).get()
    );

    const approvedEvents = snapshot.docs.filter(doc => doc.data().status === 'approved');

    for (const eventDoc of approvedEvents) {
      await syncEventVenue(eventDoc.id);
    }

    cache.delete('venues:all');
    cache.clearPattern('admin:venues:');
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
    cache.clearPattern('admin:venues:');
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
    cache.clearPattern('admin:venues:');
    return processed;
  }

  async getVenues(params: VenueFilterParams): Promise<Venue[] | PaginatedVenues> {
    const { region, capacityRange, search, sort, limit, page, status, userCoords } = params;

    let venues = await this.fetchAll();
    const today = getTaipeiDateString(new Date());

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

    if (search !== undefined && search.length > 0) {
      const normalizedSearch = normalizeSearchText(search);
      venues = venues.filter(v => normalizeSearchText(v.name).includes(normalizedSearch));
    }

    if (sort === 'random' && limit !== undefined) {
      const sampled = [...venues];
      const sampleSize = Math.min(limit, sampled.length);

      for (let index = 0; index < sampleSize; index++) {
        const swapIndex = index + Math.floor(Math.random() * (sampled.length - index));
        [sampled[index], sampled[swapIndex]] = [sampled[swapIndex], sampled[index]];
      }

      return sampled.slice(0, sampleSize).map(v => toPublicVenue(v, today));
    }

    // 未帶 sort 時預設套用綜合排序（Phase 2.8 新預設，取代舊有的「回退到 Firestore
    // orderBy('eventCount') 基礎順序」行為）。明確帶 sort=eventCount 時維持現況：
    // 不重新排序，沿用 fetchAll() 內 Firestore orderBy('eventCount','desc') 的既有順序。
    const effectiveSort = sort ?? 'composite';

    if (effectiveSort === 'composite') {
      venues = [...venues].sort(compositeTieBreak);
    } else if (sort === 'name') {
      venues = [...venues].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    } else if (sort === 'newest') {
      venues = [...venues].sort((a, b) => {
        const aMs = a.createdAt?.toMillis() ?? 0;
        const bMs = b.createdAt?.toMillis() ?? 0;
        return bMs - aMs;
      });
    } else if (sort === 'distance' && userCoords) {
      // 距離只用來排序、不寫回 venue 物件、不進 response——response 形狀與其他排序模式
      // 完全一致，用 id -> distance 的 Map 存排序期間的計算結果即可，不需要之後再從
      // 回傳物件裡 strip 掉。缺座標場地距離為 undefined，排序時一律排在最後。
      const distanceByVenueId = new Map<string, number | undefined>();
      venues.forEach(v => {
        distanceByVenueId.set(
          v.id,
          isMissingVenueCoords(v.lat, v.lng)
            ? undefined
            : haversineDistanceMeters(userCoords, { lat: v.lat, lng: v.lng })
        );
      });

      venues = [...venues].sort((a, b) => {
        const aDist = distanceByVenueId.get(a.id);
        const bDist = distanceByVenueId.get(b.id);
        const aMissing = aDist === undefined;
        const bMissing = bDist === undefined;
        if (aMissing !== bMissing) return aMissing ? 1 : -1; // 缺座標永遠排最後
        if (!aMissing && !bMissing && aDist !== bDist) {
          return aDist! - bDist!;
        }
        // 距離相同（含皆缺座標）：沿用 composite tie-break 鏈，保證分頁穩定
        return compositeTieBreak(a, b);
      });
    }

    // Fallback shape mirrors AdminService.resolvePagination, but limit is intentionally
    // NOT capped here — the public /venues SSR page needs a large limit to fetch the
    // full active set for its region-chip dropdown.
    const resolvedPage = Math.max(1, page ?? 1);
    const resolvedLimit = Math.max(1, limit ?? 20);
    const skip = (resolvedPage - 1) * resolvedLimit;

    const total = venues.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / resolvedLimit);

    return {
      venues: venues.slice(skip, skip + resolvedLimit).map(v => toPublicVenue(v, today)),
      pagination: { page: resolvedPage, limit: resolvedLimit, total, totalPages },
    };
  }
}
