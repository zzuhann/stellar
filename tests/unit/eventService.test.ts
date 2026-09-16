import { EventService } from '../../src/services/eventService';
import { UpdateEventData, CreateEventData } from '../../src/models/types';
import { cache } from '../../src/utils/cache';

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
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

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

    await expect(service.updateEventStatus('event-1', 'approved')).rejects.toThrow(
      'venue sync failed'
    );

    expect(cache.get(favoriteCacheKey)).toBeNull();
  });
});
