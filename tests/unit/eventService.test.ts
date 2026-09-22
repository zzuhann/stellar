import { EventService } from '../../src/services/eventService';
import { UpdateEventData, CreateEventData, EventsResponse } from '../../src/models/types';
import { cache } from '../../src/utils/cache';
import { syncEventVenue } from '../../src/services/eventVenueSync';

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDocRef = {
  get: mockGet,
  update: mockUpdate,
};

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

const makeTimestamp = (isoDate: string) =>
  ({
    toDate: () => new Date(isoDate),
    toMillis: () => new Date(isoDate).getTime(),
  }) as unknown as import('firebase-admin/firestore').Timestamp;

describe('EventService.getEventsWithFilters — datetime 序列化（GET /events）', () => {
  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'event-1',
            data: () => ({
              title: '測試活動',
              description: '',
              artists: [],
              location: { address: '台北市', coordinates: { lat: 25, lng: 121 } },
              datetime: {
                start: makeTimestamp('2027-01-01T00:00:00.000Z'),
                end: makeTimestamp('2027-01-02T00:00:00.000Z'),
              },
              status: 'approved',
              createdBy: 'uid-1',
            }),
          },
        ],
      }),
    });
    service = new EventService();
  });

  it('回傳的 datetime.start/end 是 ISO 8601 字串，不是 Firestore Timestamp（或 {_seconds,_nanoseconds}）物件', async () => {
    const result = (await service.getEventsWithFilters({
      status: 'approved',
    })) as EventsResponse;

    expect(result.events).toHaveLength(1);
    const { start, end } = result.events[0].datetime as unknown as { start: string; end: string };

    expect(typeof start).toBe('string');
    expect(typeof end).toBe('string');
    expect(new Date(start).toISOString()).toBe(start);
    expect(new Date(end).toISOString()).toBe(end);
    expect(start).toBe('2027-01-01T00:00:00.000Z');
    expect(end).toBe('2027-01-02T00:00:00.000Z');
  });
});

describe('syncEventVenue', () => {
  const ref = (id: string) => ({ id, path: `venues/${id}` });
  const eventRef = { id: 'e1', path: 'coffeeEvents/e1' };
  let event: Record<string, any>;
  let venues: Record<string, any>;
  let writes: Array<[any, any]>;

  beforeEach(() => {
    jest.clearAllMocks();
    event = { status: 'approved', location: { placeId: 'p1', venueId: 'v1' } };
    venues = {
      v1: { placeId: 'p1', status: 'inactive', eventRefs: [eventRef], eventCount: 1 },
      v2: { placeId: 'p2', eventRefs: [], eventCount: 0 },
    };
    writes = [];
    const firebase = jest.requireMock('../../src/config/firebase');
    firebase.db.collection.mockImplementation((name: string) => ({
      doc: (id: string) => (name === 'coffeeEvents' ? eventRef : ref(id)),
      where: (field: string, _op: string, value: unknown) => ({
        field,
        value,
        limit() {
          return this;
        },
      }),
    }));
    firebase.db.runTransaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
      await fn({
        get: (target: any) => {
          if (writes.length) throw new Error('Read after write');
          if (target === eventRef) return { exists: true, data: () => event };
          if (target.id)
            return { exists: !!venues[target.id], ref: target, data: () => venues[target.id] };
          const docs = Object.entries(venues)
            .filter(([, v]) =>
              target.field === 'placeId'
                ? v.placeId === target.value
                : v.eventRefs.some((r: any) => r.path === eventRef.path)
            )
            .map(([id, v]) => ({ id, ref: ref(id), data: () => v }));
          return { docs, size: docs.length };
        },
        update: (target: any, data: any) => writes.push([target, data]),
      });
    });
  });

  it('preserves an inactive venue when editing the same place and clears both caches', async () => {
    cache.set('venue:detail:v1', {}, 60);
    cache.set('venue:admin:detail:v1', {}, 60);
    await syncEventVenue('e1', { title: 'updated', location: { placeId: 'p1' } });
    expect(writes[writes.length - 1]?.[1]).toEqual({
      title: 'updated',
      location: { placeId: 'p1', venueId: 'v1' },
    });
    expect(cache.get('venue:detail:v1')).toBeNull();
    expect(cache.get('venue:admin:detail:v1')).toBeNull();
  });

  it.each(['p2', 'unknown', undefined])('moves away from the old venue for %s', async placeId => {
    await syncEventVenue('e1', { location: { placeId } });
    expect(writes).toContainEqual([ref('v1'), { eventRefs: [], eventCount: 0 }]);
    expect(writes[writes.length - 1]?.[1].location.venueId).toBe(
      placeId === 'p2' ? 'v2' : undefined
    );
  });

  it('repairs a missing event link without counting an existing reference twice', async () => {
    delete event.location.venueId;
    await syncEventVenue('e1');
    expect(writes).toContainEqual([ref('v1'), { eventRefs: [eventRef], eventCount: 1 }]);
    expect(writes[writes.length - 1]?.[1]['location.venueId']).toBe('v1');
    writes = [];
    event.location.venueId = 'v1';
    await syncEventVenue('e1');
    expect(writes).toContainEqual([ref('v1'), { eventRefs: [eventRef], eventCount: 1 }]);
  });

  it('does not choose an arbitrary duplicate place or link a pending event', async () => {
    delete event.location.venueId;
    venues.v2.placeId = 'p1';
    await syncEventVenue('e1');
    expect(writes.some(([target, data]) => target.id === 'v2' && data.eventCount === 1)).toBe(
      false
    );
    writes = [];
    event.status = 'pending';
    venues.v2.placeId = 'p2';
    await syncEventVenue('e1');
    expect(writes.some(([, data]) => data.eventCount === 1)).toBe(false);
  });
});

describe('EventService.resubmitEvent', () => {
  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new EventService();
  });

  it('活動狀態不是 rejected 時，丟出 409 EVENT_RESUBMIT_INVALID_STATE', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ createdBy: 'user-1', status: 'approved' }),
    });

    await expect(service.resubmitEvent('event-1', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'EVENT_RESUBMIT_INVALID_STATE',
    });
  });

  it.each(['pending', 'approved'])(
    '活動狀態為 %s（非 rejected）時同樣丟出 409 EVENT_RESUBMIT_INVALID_STATE',
    async status => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ createdBy: 'user-1', status }),
      });

      await expect(service.resubmitEvent('event-1', 'user-1')).rejects.toMatchObject({
        statusCode: 409,
        code: 'EVENT_RESUBMIT_INVALID_STATE',
      });
    }
  );
});

describe('EventService.updateEvent — 座標驗證', () => {
  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ createdBy: 'other-user', status: 'approved', verifiedOrganizers: [] }),
    });
    service = new EventService();
  });

  it('座標完全缺失時，丟出 400 VALIDATION_ERROR，field 精確為 location.coordinates', async () => {
    const updateData = {
      location: { name: '測試場地', address: '台北市測試路 1 號', coordinates: {} },
    } as unknown as UpdateEventData;

    await expect(
      service.updateEvent('event-1', updateData, 'admin-uid', 'admin')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      field: 'location.coordinates',
    });
  });

  it('只有 lng 缺失（lat 存在）時，同樣丟出 field 為 location.coordinates 的 400 VALIDATION_ERROR', async () => {
    const updateData = {
      location: {
        name: '測試場地',
        address: '台北市測試路 1 號',
        coordinates: { lat: 25.03 },
      },
    } as unknown as UpdateEventData;

    await expect(
      service.updateEvent('event-1', updateData, 'admin-uid', 'admin')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      field: 'location.coordinates',
    });
  });
});

describe('EventService.createEvent — 座標驗證', () => {
  let service: EventService;
  const mockArtistDocRef = { get: jest.fn() };
  const mockEventDocRef = { id: 'event-new', set: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'artists') {
        return { doc: jest.fn(() => mockArtistDocRef) };
      }
      // coffeeEvents collection：createEvent 用 collection.doc() 產生新 doc ref
      return { doc: jest.fn(() => mockEventDocRef) };
    });
    mockArtistDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'approved', stageName: '測試藝人', slug: 'test-artist' }),
    });
    service = new EventService();
  });

  it('藝人驗證通過但座標缺失時，丟出 400 VALIDATION_ERROR，field 精確為 location.coordinates', async () => {
    const eventData = {
      artistIds: ['artist-1'],
      title: '測試活動',
      description: '測試描述',
      location: {
        name: '測試場地',
        address: '台北市測試路 1 號',
        coordinates: {},
      },
      datetime: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-01T06:00:00.000Z' },
      socialMedia: {},
    } as unknown as CreateEventData;

    await expect(
      service.createEvent(eventData, 'user-1', 'user@example.com')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      field: 'location.coordinates',
    });
  });
});

// Resolves manually so a test can pause a Firestore mock mid-flight and
// assert on cache state before letting the awaited call proceed.
function createDeferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

// Drains the microtask queue so pending `await`s inside the service method
// (chained on already-resolved or still-pending mocks) settle before we assert.
const flushMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

describe('EventService — 狀態變更清除收藏快取', () => {
  let service: EventService;
  const favoriteCacheKey = 'favorite:user-1:event-1';

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'rejected' }),
    });
    mockUpdate.mockResolvedValue(undefined);
    service = new EventService();
  });

  afterEach(() => {
    cache.delete(favoriteCacheKey);
  });

  it('updateEventStatus 核准活動後，isFavorited 快取住的舊值會被清除，下次查詢能拿到新結果', async () => {
    // 模擬 check 端點在審核前快取住 false（例如活動當時是 rejected）
    cache.set(favoriteCacheKey, false, 1440);
    const clearPatternSpy = jest.spyOn(cache, 'clearPattern');

    await service.updateEventStatus('event-1', 'approved');

    expect(clearPatternSpy).toHaveBeenCalledWith('favorite');
    expect(cache.get(favoriteCacheKey)).toBeNull();
    clearPatternSpy.mockRestore();
  });

  it('batchUpdateEventStatus 批次核准活動後，isFavorited 快取住的舊值會被清除，下次查詢能拿到新結果', async () => {
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.batch as jest.Mock).mockReturnValue({
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    });
    cache.set(favoriteCacheKey, false, 1440);
    const clearPatternSpy = jest.spyOn(cache, 'clearPattern');

    mockGet.mockResolvedValue({
      id: 'event-1',
      exists: true,
      data: () => ({ status: 'rejected' }),
    });

    await service.batchUpdateEventStatus([{ eventId: 'event-1', status: 'approved' }]);

    expect(clearPatternSpy).toHaveBeenCalledWith('favorite');
    expect(cache.get(favoriteCacheKey)).toBeNull();
    clearPatternSpy.mockRestore();
  });

  it('updateEventStatus 場地同步失敗仍會拋出例外，但 favorite 快取在拋錯前已被清除', async () => {
    // 場地同步（linkEventToVenue）發生在快取清除之後，這裡驗證即使它失敗，
    // 快取清除的順序保證不受影響（狀態已成功寫入 DB，快取必須先清）
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'venues') {
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockRejectedValue(new Error('venue sync failed')),
        };
      }
      return { doc: jest.fn(() => mockDocRef) };
    });
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'rejected', location: { placeId: 'place-1' } }),
    });
    cache.set(favoriteCacheKey, false, 1440);

    firebase.db.runTransaction.mockRejectedValueOnce(new Error('venue sync failed'));
    await expect(service.updateEventStatus('event-1', 'approved')).rejects.toThrow(
      'venue sync failed'
    );

    expect(cache.get(favoriteCacheKey)).toBeNull();
  });

  it('updateEventStatus 快取清除時序：DB 寫入完成才清 favorite，artists 與 venue 同步完成才清其餘快取', async () => {
    const firebase = jest.requireMock('../../src/config/firebase');

    // Controls when the Firestore status write "completes".
    const writeDeferred = createDeferred<void>();
    mockUpdate.mockImplementation(() => writeDeferred.promise);

    // Controls when the downstream artists sync (updateArtistsActiveEventIds) "completes".
    const artistSyncDeferred = createDeferred<void>();
    const mockArtistDocRef = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ activeEventIds: [] }) }),
    };
    const mockArtistBatch = {
      update: jest.fn(),
      commit: jest.fn(() => artistSyncDeferred.promise),
    };

    // Controls when the downstream venue sync (linkEventToVenue's transaction) "completes".
    const venueSyncDeferred = createDeferred<void>();
    const mockVenueCollection = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: false, docs: [{ id: 'venue-1', ref: {} }] }),
    };

    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'artists') {
        return { doc: jest.fn(() => mockArtistDocRef) };
      }
      if (name === 'venues') {
        return mockVenueCollection;
      }
      return { doc: jest.fn(() => mockDocRef) };
    });
    (firebase.db.batch as jest.Mock).mockReturnValue(mockArtistBatch);
    (firebase.db.runTransaction as jest.Mock).mockImplementation(() => venueSyncDeferred.promise);

    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'rejected',
        artists: [{ id: 'artist-1' }],
        location: { placeId: 'place-1' },
      }),
    });

    cache.set(favoriteCacheKey, false, 1440);
    cache.set('artists:approved', ['stale'], 1440);
    cache.set('venue:detail:venue-1', { stale: true }, 1440);
    cache.set('venues:all', ['stale'], 1440);

    const resultPromise = service.updateEventStatus('event-1', 'approved');

    // Checkpoint 1: DB 寫入尚未完成，favorite 快取還沒被清
    await flushMicrotasks();
    expect(cache.get(favoriteCacheKey)).toEqual(false);

    writeDeferred.resolve();

    // Checkpoint 2: DB 寫入完成、artists 同步尚未完成 → favorite 已清，其餘快取（含 venue）還在
    await flushMicrotasks();
    await flushMicrotasks();
    expect(cache.get(favoriteCacheKey)).toBeNull();
    expect(cache.get('artists:approved')).toEqual(['stale']);
    expect(cache.get('venue:detail:venue-1')).toEqual({ stale: true });
    expect(cache.get('venues:all')).toEqual(['stale']);

    artistSyncDeferred.resolve();

    // Checkpoint 3: artists 同步完成、venue 同步（transaction）尚未完成 → venue 快取仍在
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(cache.get('venue:detail:venue-1')).toEqual({ stale: true });
    expect(cache.get('venues:all')).toEqual(['stale']);
    expect(cache.get('artists:approved')).toEqual(['stale']);

    venueSyncDeferred.resolve();

    // Checkpoint 4: venue 同步完成後，venue 快取與其餘快取才被清除
    await resultPromise;
    expect(cache.get('venue:detail:venue-1')).toBeNull();
    expect(cache.get('venues:all')).toBeNull();
    expect(cache.get('artists:approved')).toBeNull();

    cache.delete('artists:approved');
    cache.delete('venue:detail:venue-1');
    cache.delete('venues:all');
  });

  it('batchUpdateEventStatus 快取清除時序：DB 批次寫入完成才清 favorite，artists 與 venue 同步完成才清其餘快取', async () => {
    const firebase = jest.requireMock('../../src/config/firebase');

    // First db.batch() call is the event status batch, second is the artists sync batch.
    const writeDeferred = createDeferred<void>();
    const eventBatchMock = { update: jest.fn(), commit: jest.fn(() => writeDeferred.promise) };

    const artistSyncDeferred = createDeferred<void>();
    const artistBatchMock = {
      update: jest.fn(),
      commit: jest.fn(() => artistSyncDeferred.promise),
    };

    (firebase.db.batch as jest.Mock)
      .mockImplementationOnce(() => eventBatchMock)
      .mockImplementationOnce(() => artistBatchMock);

    // Controls when the downstream venue sync (linkEventToVenue's transaction) "completes".
    const venueSyncDeferred = createDeferred<void>();
    const mockVenueCollection = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: false, docs: [{ id: 'venue-1', ref: {} }] }),
    };
    (firebase.db.runTransaction as jest.Mock).mockImplementation(() => venueSyncDeferred.promise);

    const mockArtistDocRef = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ activeEventIds: [] }) }),
    };
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'artists') {
        return { doc: jest.fn(() => mockArtistDocRef) };
      }
      if (name === 'venues') {
        return mockVenueCollection;
      }
      return { doc: jest.fn(() => mockDocRef) };
    });

    mockGet.mockResolvedValue({
      id: 'event-1',
      exists: true,
      data: () => ({
        status: 'rejected',
        artists: [{ id: 'artist-1' }],
        location: { placeId: 'place-1' },
      }),
    });

    cache.set(favoriteCacheKey, false, 1440);
    cache.set('artists:approved', ['stale'], 1440);
    cache.set('venue:detail:venue-1', { stale: true }, 1440);
    cache.set('venues:all', ['stale'], 1440);

    const resultPromise = service.batchUpdateEventStatus([
      { eventId: 'event-1', status: 'approved' },
    ]);

    // Checkpoint 1: DB 批次寫入尚未完成，favorite 快取還沒被清
    await flushMicrotasks();
    expect(cache.get(favoriteCacheKey)).toEqual(false);

    writeDeferred.resolve();

    // Checkpoint 2: DB 批次寫入完成、artists 同步尚未完成 → favorite 已清，其餘快取（含 venue）還在
    await flushMicrotasks();
    await flushMicrotasks();
    expect(cache.get(favoriteCacheKey)).toBeNull();
    expect(cache.get('artists:approved')).toEqual(['stale']);
    expect(cache.get('venue:detail:venue-1')).toEqual({ stale: true });
    expect(cache.get('venues:all')).toEqual(['stale']);

    artistSyncDeferred.resolve();

    // Checkpoint 3: artists 同步完成、venue 同步（transaction）尚未完成 → venue 快取仍在
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(cache.get('venue:detail:venue-1')).toEqual({ stale: true });
    expect(cache.get('venues:all')).toEqual(['stale']);
    expect(cache.get('artists:approved')).toEqual(['stale']);

    venueSyncDeferred.resolve();

    // Checkpoint 4: venue 同步完成後，venue 快取與其餘快取才被清除
    await resultPromise;
    expect(cache.get('venue:detail:venue-1')).toBeNull();
    expect(cache.get('venues:all')).toBeNull();
    expect(cache.get('artists:approved')).toBeNull();

    cache.delete('artists:approved');
    cache.delete('venue:detail:venue-1');
    cache.delete('venues:all');
  });
});
