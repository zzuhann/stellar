import { VenueService } from '../../src/services/venueService';
import { cache } from '../../src/utils/cache';
import { CapacityRange, Venue, VenueStatus } from '../../src/models/types';

const mockDelete = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockSet = jest.fn();
const mockDocRef = {
  id: 'venue-1',
  get: mockGet,
  delete: mockDelete,
  update: mockUpdate,
  set: mockSet,
};

const mockCollectionGet = jest.fn();
const mockWhere = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(),
    getAll: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

describe('VenueService.createVenue', () => {
  it('pending 場地不清公開列表 cache，但清除 admin cache', async () => {
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({ doc: jest.fn(() => mockDocRef) });
    mockSet.mockResolvedValue(undefined);
    const deleteSpy = jest.spyOn(cache, 'delete');
    const clearPatternSpy = jest.spyOn(cache, 'clearPattern');

    await new VenueService().createVenue({
      name: '測試場地',
      address: '台北市測試路 1 號',
      region: '台北',
      capacityRange: '20-40',
      preferredContact: 'instagram',
      coverPhoto: 'https://example.com/cover.jpg',
      socialMedia: { instagram: 'venue' },
    });

    expect(deleteSpy).not.toHaveBeenCalledWith('venues:all');
    expect(clearPatternSpy).toHaveBeenCalledWith('admin:venues:');
    deleteSpy.mockRestore();
    clearPatternSpy.mockRestore();
  });
});

describe('VenueService.permanentDeleteVenue', () => {
  let service: VenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new VenueService();
  });

  it('場地不存在 → not_found', async () => {
    mockGet.mockResolvedValue({ exists: false });
    await expect(service.permanentDeleteVenue('venue-123')).resolves.toBe('not_found');
  });

  it('有關聯活動 → has_events，不呼叫 Firestore delete', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ eventRefs: [{ id: 'event-1' }] }),
    });
    await expect(service.permanentDeleteVenue('venue-123')).resolves.toBe('has_events');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('無關聯活動 → deleted，呼叫 Firestore delete', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ eventRefs: [] }),
    });
    mockDelete.mockResolvedValue(undefined);
    await expect(service.permanentDeleteVenue('venue-123')).resolves.toBe('deleted');
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('VenueService.batchReview', () => {
  let service: VenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'coffeeEvents') {
        return {
          where: mockWhere,
          doc: jest.fn(() => mockDocRef),
        };
      }
      return {
        doc: jest.fn(() => mockDocRef),
        where: mockWhere,
      };
    });
    mockWhere.mockReturnValue({ get: mockCollectionGet });
    (firebase.db.runTransaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = { get: jest.fn(), update: jest.fn() };
        await fn(tx);
      }
    );
    service = new VenueService();
  });

  it('非 pending 的場地跳過，processed = 0', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', placeId: 'place-1' }),
    });

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('場地不存在跳過，processed = 0', async () => {
    mockGet.mockResolvedValue({ exists: false });

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('pending → rejected，不觸發 onVenueApproved，processed = 1', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', placeId: 'place-1' }),
    });
    mockUpdate.mockResolvedValue(undefined);
    // onVenueApproved should NOT be triggered; mockCollectionGet should not be called
    mockCollectionGet.mockResolvedValue({ docs: [] });

    const result = await service.batchReview([{ venueId: 'v1', status: 'rejected' }]);
    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  it('pending → active，觸發 onVenueApproved，processed = 1', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', placeId: 'place-1' }),
    });
    mockUpdate.mockResolvedValue(undefined);
    // onVenueApproved queries coffeeEvents
    mockCollectionGet.mockResolvedValue({ docs: [] });

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCollectionGet).toHaveBeenCalledTimes(1);
  });

  it('pending → active 但 placeId 為空，不呼叫 coffeeEvents 查詢', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', placeId: '' }),
    });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(1);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  it('混合更新：2 pending + 1 active → processed = 2', async () => {
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pending', placeId: '' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'active', placeId: 'place-2' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pending', placeId: '' }),
      });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchReview([
      { venueId: 'v1', status: 'active' },
      { venueId: 'v2', status: 'active' }, // status is active, should be skipped
      { venueId: 'v3', status: 'rejected' },
    ]);
    expect(result).toBe(2);
  });
});

describe('VenueService.batchStatus', () => {
  let service: VenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new VenueService();
  });

  it('場地不存在跳過，processed = 0', async () => {
    mockGet.mockResolvedValue({ exists: false });

    const result = await service.batchStatus([{ venueId: 'v1', status: 'inactive' }]);
    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('場地存在 → 更新 status，processed = 1', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active' }),
    });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchStatus([{ venueId: 'v1', status: 'inactive' }]);
    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('多筆更新，全部存在 → processed = 3', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active' }),
    });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchStatus([
      { venueId: 'v1', status: 'inactive' },
      { venueId: 'v2', status: 'active' },
      { venueId: 'v3', status: 'inactive' },
    ]);
    expect(result).toBe(3);
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });
});

describe('VenueService.getVenues random sampling', () => {
  const venues = Array.from({ length: 12 }, (_, index) => ({
    id: `venue-${index + 1}`,
    name: `場地 ${index + 1}`,
    address: '台北市測試路 1 號',
    region: index < 5 ? '台北' : '新北',
    lat: 25,
    lng: 121,
    nearestMrt: '',
    mrtWalkMinutes: null,
    capacityRange: '20-40' as const,
    eventCount: index,
    coverPhoto: '',
    otherPhotos: [],
    description: '',
    hostTags: [],
    status: (index === 11 ? 'inactive' : 'active') as 'active' | 'inactive',
  }));

  let getWithLockSpy: jest.SpyInstance;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it('只從 active 場地抽出指定數量，且不重複', async () => {
    const result = (await new VenueService().getVenues({ sort: 'random', limit: 10 })) as Venue[];

    expect(result).toHaveLength(10);
    expect(new Set(result.map(venue => venue.id)).size).toBe(10);
    expect(result.every(venue => venue.status === 'active')).toBe(true);
  });

  it('符合條件的場地不足 limit 時回傳全部', async () => {
    const result = (await new VenueService().getVenues({
      region: ['台北'],
      sort: 'random',
      limit: 10,
    })) as Venue[];

    expect(result.map(venue => venue.id)).toEqual([
      'venue-1',
      'venue-2',
      'venue-3',
      'venue-4',
      'venue-5',
    ]);
  });

  it('每次 request 都重新執行抽樣，同時重用 venues:all cache', async () => {
    const service = new VenueService();

    await service.getVenues({ sort: 'random', limit: 10 });
    await service.getVenues({ sort: 'random', limit: 10 });

    expect(randomSpy).toHaveBeenCalledTimes(20);
    expect(getWithLockSpy).toHaveBeenCalledTimes(2);
    expect(getWithLockSpy).toHaveBeenCalledWith('venues:all', expect.any(Function), 1440);
  });

  it('random 模式套用 search 後才抽樣，回應形狀不變（不含 pagination）', async () => {
    const service = new VenueService();

    const result = await service.getVenues({ search: '場地', sort: 'random', limit: 10 });

    // fixture 的名稱都是「場地 N」，全部符合 search（11 筆 active），抽樣後仍受 limit 限制
    expect(Array.isArray(result)).toBe(true);
    expect(result as unknown[]).toHaveLength(10);
    expect(result).not.toHaveProperty('pagination');
  });
});

type VenueFixture = Omit<Venue, 'capacityRange' | 'status'> & {
  capacityRange: CapacityRange;
  status: VenueStatus;
};

const buildVenue = (overrides: Partial<VenueFixture>): VenueFixture => ({
  ...makeBaseVenue(),
  ...overrides,
});

function makeBaseVenue(): VenueFixture {
  return {
    id: 'venue-base',
    name: '',
    address: '台北市測試路 1 號',
    region: '台北',
    lat: 25,
    lng: 121,
    nearestMrt: '',
    mrtWalkMinutes: null,
    capacityRange: '20-40',
    eventCount: 0,
    coverPhoto: '',
    otherPhotos: [],
    description: '',
    hostTags: [],
    status: 'active',
  };
}

describe('VenueService.getVenues — search 正規化比對', () => {
  const venues = [
    buildVenue({ id: 'v-abc', name: 'ABC Mart', region: '台北' }),
    buildVenue({ id: 'v-scoups', name: 'S.Coups', region: '新北' }),
    buildVenue({ id: 'v-other', name: '測試場地', region: '台北' }),
  ];

  let getWithLockSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
  });

  it('search=abcmart 比對到名稱為 ABC Mart 的場地（空白被忽略）', async () => {
    const result = await new VenueService().getVenues({ search: 'abcmart' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['v-abc']);
  });

  it('search=scoups 比對到名稱為 S.Coups 的場地（標點被忽略）', async () => {
    const result = await new VenueService().getVenues({ search: 'scoups' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['v-scoups']);
  });

  it('search 不分大小寫（SCOUPS / scoups 結果相同）', async () => {
    const upper = await new VenueService().getVenues({ search: 'SCOUPS' });
    const lower = await new VenueService().getVenues({ search: 'scoups' });
    if (Array.isArray(upper) || Array.isArray(lower)) throw new Error('expected paginated result');
    expect(upper.venues.map(v => v.id)).toEqual(lower.venues.map(v => v.id));
  });

  it('search 為空字串時不套用搜尋 filter', async () => {
    const result = await new VenueService().getVenues({ search: '' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toHaveLength(3);
  });

  it('search 未帶時不套用搜尋 filter', async () => {
    const result = await new VenueService().getVenues({});
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toHaveLength(3);
  });

  it('search 沒有任何場地符合時，回傳空陣列與 total/totalPages 為 0', async () => {
    const result = await new VenueService().getVenues({ search: '完全不存在的關鍵字xyz' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });
});

describe('VenueService.getVenues — filter 交集', () => {
  const venues = [
    buildVenue({ id: 'v1', name: 'ABC Mart', region: '台北', capacityRange: '20-40' }),
    buildVenue({ id: 'v2', name: 'ABC Cafe', region: '台北', capacityRange: '40-60' }),
    buildVenue({ id: 'v3', name: 'ABC Studio', region: '新北', capacityRange: '20-40' }),
    buildVenue({ id: 'v4', name: '其他場地', region: '台北', capacityRange: '20-40' }),
  ];

  let getWithLockSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
  });

  it('region + capacityRange + search 同時帶入時為交集，非聯集', async () => {
    const result = await new VenueService().getVenues({
      region: ['台北'],
      capacityRange: '20-40',
      search: 'abc',
    });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['v1']);
  });

  it('只帶 capacityRange（不帶 region）時，僅套用容納人數 filter', async () => {
    const result = await new VenueService().getVenues({ capacityRange: '20-40' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id).sort()).toEqual(['v1', 'v3', 'v4']);
  });

  it('疊加後結果為 0 筆時，pagination.total 為 0', async () => {
    const result = await new VenueService().getVenues({
      region: ['新北'],
      capacityRange: '40-60',
    });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });
});

describe('VenueService.getVenues — 分頁', () => {
  const venues = Array.from({ length: 25 }, (_, index) =>
    buildVenue({ id: `venue-${index + 1}`, name: `場地 ${index + 1}` })
  );

  let getWithLockSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
  });

  it('25 筆、limit=20 時，第 1 頁回 20 筆、totalPages=2', async () => {
    const result = await new VenueService().getVenues({ page: 1, limit: 20 });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toHaveLength(20);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
  });

  it('25 筆、limit=20 時，第 2 頁回 5 筆', async () => {
    const result = await new VenueService().getVenues({ page: 2, limit: 20 });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toHaveLength(5);
    expect(result.pagination.totalPages).toBe(2);
  });

  it('page 超過 totalPages 時回傳空陣列，pagination.page 仍回傳請求值', async () => {
    const result = await new VenueService().getVenues({ page: 99, limit: 20 });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues).toEqual([]);
    expect(result.pagination.page).toBe(99);
  });

  it.each([0, -1])('page 為非正整數（%s）時 fallback 為 1', async page => {
    const result = await new VenueService().getVenues({ page, limit: 20 });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.pagination.page).toBe(1);
  });

  it('limit 未帶時 fallback 為預設值 20', async () => {
    const result = await new VenueService().getVenues({ page: 1 });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.pagination.limit).toBe(20);
    expect(result.venues).toHaveLength(20);
  });

  it('不帶 page/limit 時，行為等同 page=1&limit=20', async () => {
    const result = await new VenueService().getVenues({});
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
    expect(result.venues).toHaveLength(20);
  });

  it('同一批 filter 條件下的多次 request 不重複打 Firestore，只在記憶體中重新 filter/分頁', async () => {
    const service = new VenueService();
    await service.getVenues({ page: 1, limit: 20 });
    await service.getVenues({ page: 2, limit: 20 });

    expect(getWithLockSpy).toHaveBeenCalledTimes(2);
    expect(getWithLockSpy).toHaveBeenCalledWith('venues:all', expect.any(Function), 1440);
  });
});

// --- Phase 2.8 場地綜合排序 -------------------------------------------------

type ScoredVenueFixture = Omit<VenueFixture, 'createdAt'> & {
  compositeScore: number;
  createdAt?: { toMillis: () => number };
};

const buildScoredVenue = (overrides: Partial<ScoredVenueFixture>): ScoredVenueFixture => ({
  ...makeBaseVenue(),
  compositeScore: 0,
  ...overrides,
});

describe('VenueService.getVenues — composite 排序 tie-break', () => {
  let getWithLockSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
  });

  it('compositeScore 相同時，依 createdAt desc 排序（較新上架排前面）', async () => {
    const venues = [
      buildScoredVenue({ id: 'old', compositeScore: 0.5, createdAt: { toMillis: () => 1000 } }),
      buildScoredVenue({ id: 'new', compositeScore: 0.5, createdAt: { toMillis: () => 2000 } }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({});
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['new', 'old']);
  });

  it('compositeScore 與 createdAt 皆相同（理論邊界）時，依 id 排序，確保排序具決定性', async () => {
    const venues = [
      buildScoredVenue({ id: 'b', compositeScore: 0.5, createdAt: { toMillis: () => 1000 } }),
      buildScoredVenue({ id: 'a', compositeScore: 0.5, createdAt: { toMillis: () => 1000 } }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({});
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['a', 'b']);
  });

  it('三筆以上同分同 createdAt 場地跨分頁查詢（limit=1）時，不因排序不穩定而重複或漏出資料', async () => {
    const venues = ['c', 'a', 'b'].map(id =>
      buildScoredVenue({ id, compositeScore: 0.5, createdAt: { toMillis: () => 1000 } })
    );
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const service = new VenueService();
    const page1 = await service.getVenues({ limit: 1, page: 1 });
    const page2 = await service.getVenues({ limit: 1, page: 2 });
    const page3 = await service.getVenues({ limit: 1, page: 3 });
    if (Array.isArray(page1) || Array.isArray(page2) || Array.isArray(page3)) {
      throw new Error('expected paginated result');
    }

    const ids = [...page1.venues, ...page2.venues, ...page3.venues].map(v => v.id);
    expect(ids).toEqual(['a', 'b', 'c']); // id asc tie-break：跨頁不重複、不遺漏
  });

  it('getVenues() 回傳的每筆 venue 物件不含 compositeScore 欄位', async () => {
    const venues = [buildScoredVenue({ id: 'v1', compositeScore: 0.7 })];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({});
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues[0]).not.toHaveProperty('compositeScore');
  });
});

describe('VenueService.getVenues — sort 參數與 fallback', () => {
  let getWithLockSpy: jest.SpyInstance;

  const venues = [
    buildScoredVenue({
      id: 'low',
      compositeScore: 0.2,
      eventCount: 5,
      name: 'B',
      createdAt: { toMillis: () => 1000 },
    }),
    buildScoredVenue({
      id: 'high',
      compositeScore: 0.8,
      eventCount: 1,
      name: 'A',
      createdAt: { toMillis: () => 2000 },
    }),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
  });

  it('未帶 sort 參數時，排序結果等同 sort=composite（新預設）', async () => {
    const withoutSort = await new VenueService().getVenues({});
    const withComposite = await new VenueService().getVenues({ sort: 'composite' });
    if (Array.isArray(withoutSort) || Array.isArray(withComposite)) {
      throw new Error('expected paginated result');
    }
    expect(withoutSort.venues.map(v => v.id)).toEqual(['high', 'low']); // compositeScore 0.8 > 0.2
    expect(withoutSort.venues.map(v => v.id)).toEqual(withComposite.venues.map(v => v.id));
  });

  it('sort=eventCount 明確指定時，維持 fetchAll() 既有的 eventCount desc 自然順序，不受 compositeScore 影響', async () => {
    // fetchAll() 底層用 Firestore orderBy('eventCount','desc')，這裡 fixture 陣列順序
    // 本身就代表該自然順序（'low' eventCount=5 在前，'high' eventCount=1 在後）
    const result = await new VenueService().getVenues({ sort: 'eventCount' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['low', 'high']);
  });

  it('sort=newest 行為與現況不變，不受 composite 分支影響', async () => {
    const result = await new VenueService().getVenues({ sort: 'newest' });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['high', 'low']); // createdAt desc: 2000 > 1000
  });

  it('sort=random 行為與現況不變，不受本次改動影響（不含 pagination）', async () => {
    const result = await new VenueService().getVenues({ sort: 'random', limit: 2 });
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toHaveProperty('pagination');
  });

  it('sort=composite 與 region/page/limit 疊加使用時，先完成 filter 再套用綜合排序，分頁結果正確', async () => {
    const mixedVenues = [
      buildScoredVenue({ id: 'v1', region: '台北', compositeScore: 0.9 }),
      buildScoredVenue({ id: 'v2', region: '新北', compositeScore: 0.95 }),
      buildScoredVenue({ id: 'v3', region: '台北', compositeScore: 0.1 }),
    ];
    getWithLockSpy.mockResolvedValue(mixedVenues);

    const result = await new VenueService().getVenues({
      region: ['台北'],
      sort: 'composite',
      limit: 1,
      page: 1,
    });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    // v2 是新北，被 region filter 排除；台北中 v1(0.9) > v3(0.1)
    expect(result.venues.map(v => v.id)).toEqual(['v1']);
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});

describe('VenueService.getVenues — fetchAll 效能設計與 cold start（避免 N+1）', () => {
  let service: VenueService;
  const mockVenuesGet = jest.fn();
  const mockViewsGet = jest.fn();

  const fakeTimestamp = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
  const venueDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'venueViewDaily') {
        return { where: jest.fn().mockReturnValue({ get: mockViewsGet }) };
      }
      return { orderBy: jest.fn().mockReturnValue({ get: mockVenuesGet }) };
    });
    (firebase.db.getAll as jest.Mock).mockResolvedValue([]);
    mockViewsGet.mockResolvedValue({ docs: [] });
    mockVenuesGet.mockResolvedValue({ docs: [] });
    service = new VenueService();
  });

  it('活躍週數計算對 eventRefs 使用單次 db.getAll batch get，不逐場地個別查詢（呼叫次數與場地數無關）', async () => {
    const firebase = jest.requireMock('../../src/config/firebase');
    const venues = Array.from({ length: 5 }, (_, i) =>
      venueDoc(`v${i}`, {
        name: `場地${i}`,
        status: 'active',
        eventCount: 0,
        eventRefs: [{ id: `event-${i}` }],
        createdAt: fakeTimestamp(0),
      })
    );
    mockVenuesGet.mockResolvedValue({ docs: venues });

    await service.getVenues({});

    expect(firebase.db.getAll).toHaveBeenCalledTimes(1);
  });

  it('瀏覽數聚合使用單一 venueViewDaily range query，呼叫次數固定為 1 次，不隨場地數增加', async () => {
    const venues = Array.from({ length: 8 }, (_, i) =>
      venueDoc(`v${i}`, { name: `場地${i}`, status: 'active', eventCount: 0, eventRefs: [] })
    );
    mockVenuesGet.mockResolvedValue({ docs: venues });

    await service.getVenues({});

    expect(mockViewsGet).toHaveBeenCalledTimes(1);
  });

  it('venues:all cache 有效期間內，重複呼叫不重新觸發活躍週數 batch get 或瀏覽數 query', async () => {
    const firebase = jest.requireMock('../../src/config/firebase');
    const venues = [
      venueDoc('v1', {
        name: '場地1',
        status: 'active',
        eventCount: 0,
        eventRefs: [{ id: 'event-1' }],
        createdAt: fakeTimestamp(0),
      }),
    ];
    mockVenuesGet.mockResolvedValue({ docs: venues });

    await service.getVenues({});
    await service.getVenues({ page: 2 });

    expect(mockVenuesGet).toHaveBeenCalledTimes(1);
    expect(firebase.db.getAll).toHaveBeenCalledTimes(1);
    expect(mockViewsGet).toHaveBeenCalledTimes(1);
  });

  it('venueViewDaily 為空（cold start）時，viewScore 一律為 0，不 fallback 到 viewCount 累計數，且不報錯', async () => {
    const venues = [
      venueDoc('v-high-viewcount', {
        name: '高 viewCount 但無 daily bucket',
        status: 'active',
        eventCount: 0,
        eventRefs: [],
        viewCount: 99999, // 不應被拿來當 fallback
        createdAt: fakeTimestamp(1000),
      }),
      venueDoc('v-newer', {
        name: '較新場地，viewCount 為 0',
        status: 'active',
        eventCount: 0,
        eventRefs: [],
        viewCount: 0,
        createdAt: fakeTimestamp(2000),
      }),
    ];
    mockVenuesGet.mockResolvedValue({ docs: venues });
    mockViewsGet.mockResolvedValue({ docs: [] }); // cold start

    const result = await service.getVenues({});
    if (Array.isArray(result)) throw new Error('expected paginated result');

    // 若錯誤地 fallback 到 viewCount，'v-high-viewcount' 分數會遠高於 'v-newer' 而排前面；
    // 正確行為是兩者 viewScore 皆為 0（近 26 週活躍週數也皆為 0），
    // 僅靠 createdAt desc tie-break 排序，'v-newer' 應排前面。
    expect(result.venues.map(v => v.id)).toEqual(['v-newer', 'v-high-viewcount']);
  });

  it('mapDocToVenue：lat 缺值但 lng 有值時，兩者正規化為 (0,0)，判定為缺座標並排在最後（防止單側缺值誤判為有效座標）', async () => {
    const venues = [
      venueDoc('v-half-missing', {
        name: '只有經度的場地',
        status: 'active',
        eventCount: 0,
        eventRefs: [],
        lat: null,
        lng: 121.5,
      }),
      venueDoc('v-valid', {
        name: '座標正常的場地',
        status: 'active',
        eventCount: 0,
        eventRefs: [],
        lat: 25.1,
        lng: 121.5,
      }),
    ];
    mockVenuesGet.mockResolvedValue({ docs: venues });

    // 使用者座標故意貼近 (0, 121.5)：若 mapDocToVenue 把單側缺值的場地變成
    // { lat: 0, lng: 121.5 }（只把缺的那一邊設 0、另一邊維持原值），會被誤判為有效
    // 座標且距離使用者極近，排到第一位。正確行為是兩邊都正規化為 (0, 0)，
    // isMissingVenueCoords(0, 0) === true，一律排在最後。
    const result = await service.getVenues({
      sort: 'distance',
      userCoords: { lat: 0, lng: 121.5 },
    });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['v-valid', 'v-half-missing']);
    expect(result.venues.find(v => v.id === 'v-half-missing')).toMatchObject({ lat: 0, lng: 0 });
  });
});

// --- 場地距離最近排序（sort=distance）--------------------------------------
// 對應 specs/features/venue-distance-sort/qa.md 後端情境 1-7

describe('VenueService.getVenues — sort=distance', () => {
  let getWithLockSpy: jest.SpyInstance;

  // 使用者座標：台北 101 附近
  const userCoords = { lat: 25.033, lng: 121.5654 };

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    getWithLockSpy.mockRestore();
  });

  it('情境 1：有座標場地依距離由近到遠排序', async () => {
    const venues = [
      // 刻意打亂原始順序，確認排序而非沿用輸入順序
      buildScoredVenue({ id: 'far', lat: 22.6273, lng: 120.3014 }), // 高雄，最遠
      buildScoredVenue({ id: 'near', lat: 25.033, lng: 121.566 }), // 幾乎同點，最近
      buildScoredVenue({ id: 'mid', lat: 25.0478, lng: 121.517 }), // 台北車站，中距離
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({ sort: 'distance', userCoords });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['near', 'mid', 'far']);
  });

  it('情境 2：缺座標場地（undefined/null/NaN/兩者為 0）一律排在有座標場地之後', async () => {
    const venues = [
      buildScoredVenue({ id: 'missing-undefined', lat: undefined, lng: undefined }),
      buildScoredVenue({ id: 'has-coords', lat: 25.033, lng: 121.566 }),
      buildScoredVenue({ id: 'missing-null', lat: null, lng: null }),
      buildScoredVenue({ id: 'missing-zero', lat: 0, lng: 0 }),
      buildScoredVenue({ id: 'missing-nan', lat: NaN, lng: NaN }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({ sort: 'distance', userCoords });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    const ids = result.venues.map(v => v.id);
    expect(ids[0]).toBe('has-coords');
    expect(ids.slice(1).sort()).toEqual(
      ['missing-undefined', 'missing-null', 'missing-zero', 'missing-nan'].sort()
    );
  });

  it('情境 3：只有一邊為 0（lat=0, lng=121.5）視為有效座標，正常參與排序，不被排到最後', async () => {
    const venues = [
      buildScoredVenue({ id: 'zero-lat-only', lat: 0, lng: 121.5 }),
      buildScoredVenue({ id: 'missing', lat: undefined, lng: undefined }),
      buildScoredVenue({ id: 'far', lat: 22.6273, lng: 120.3014 }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({ sort: 'distance', userCoords });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    const ids = result.venues.map(v => v.id);
    // 'zero-lat-only' 有效座標，距離比 'far' 遠（不同緯度差很大）但仍排在真正缺座標的 'missing' 之前
    expect(ids.indexOf('zero-lat-only')).toBeLessThan(ids.indexOf('missing'));
    expect(ids[ids.length - 1]).toBe('missing');
  });

  it('情境 4a：距離相同時依 compositeScore desc → createdAt desc → id asc tie-break', async () => {
    const samePoint = { lat: 25.05, lng: 121.6 };
    const venues = [
      buildScoredVenue({
        id: 'low-score',
        ...samePoint,
        compositeScore: 0.2,
        createdAt: { toMillis: () => 2000 },
      }),
      buildScoredVenue({
        id: 'high-score',
        ...samePoint,
        compositeScore: 0.9,
        createdAt: { toMillis: () => 1000 },
      }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({ sort: 'distance', userCoords });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['high-score', 'low-score']);
  });

  it('情境 4b：缺座標場地彼此之間同樣依 compositeScore tie-break，而非隨機或原始順序', async () => {
    const venues = [
      buildScoredVenue({ id: 'missing-low', lat: undefined, lng: undefined, compositeScore: 0.1 }),
      buildScoredVenue({ id: 'missing-high', lat: undefined, lng: undefined, compositeScore: 0.9 }),
      buildScoredVenue({ id: 'has-coords', lat: 25.033, lng: 121.566, compositeScore: 0 }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({ sort: 'distance', userCoords });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(result.venues.map(v => v.id)).toEqual(['has-coords', 'missing-high', 'missing-low']);
  });

  it('情境 5：距離相同＋缺座標混合，跨頁（limit=1, page:1/2/3）無重複、無遺漏', async () => {
    const samePoint = { lat: 25.05, lng: 121.6 };
    const venues = [
      buildScoredVenue({
        id: 'b',
        ...samePoint,
        compositeScore: 0.5,
        createdAt: { toMillis: () => 1000 },
      }),
      buildScoredVenue({
        id: 'a',
        ...samePoint,
        compositeScore: 0.5,
        createdAt: { toMillis: () => 1000 },
      }),
      buildScoredVenue({ id: 'missing', lat: undefined, lng: undefined, compositeScore: 0.5 }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const service = new VenueService();
    const page1 = await service.getVenues({ sort: 'distance', userCoords, limit: 1, page: 1 });
    const page2 = await service.getVenues({ sort: 'distance', userCoords, limit: 1, page: 2 });
    const page3 = await service.getVenues({ sort: 'distance', userCoords, limit: 1, page: 3 });
    if (Array.isArray(page1) || Array.isArray(page2) || Array.isArray(page3)) {
      throw new Error('expected paginated result');
    }

    const ids = [...page1.venues, ...page2.venues, ...page3.venues].map(v => v.id);
    expect(ids).toEqual(['a', 'b', 'missing']); // 有座標依 id asc tie-break 排前面，缺座標排最後
  });

  it('情境 6：與 region/capacityRange/search 同時疊加，先完成三者 filter 交集再依距離排序', async () => {
    const venues = [
      // 符合 region=台北 + capacityRange=20-40 + search='abc' 的兩筆，距離不同
      buildScoredVenue({
        id: 'match-near',
        region: '台北',
        capacityRange: '20-40',
        name: 'ABC Mart',
        lat: 25.033,
        lng: 121.566,
      }),
      buildScoredVenue({
        id: 'match-far',
        region: '台北',
        capacityRange: '20-40',
        name: 'ABC Mart 分店',
        lat: 22.6273,
        lng: 120.3014,
      }),
      // 地區不符（新北），即使座標比 match-far 更近也應被排除
      buildScoredVenue({
        id: 'wrong-region',
        region: '新北',
        capacityRange: '20-40',
        name: 'ABC Mart 新北店',
        lat: 25.034,
        lng: 121.567,
      }),
      // capacityRange 不符（60以上），座標比 match-near 更近也應被排除
      buildScoredVenue({
        id: 'wrong-capacity',
        region: '台北',
        capacityRange: '60以上',
        name: 'ABC Mart 大場地',
        lat: 25.033,
        lng: 121.566,
      }),
      // 名稱不含 'abc'，座標比 match-near 更近也應被排除
      buildScoredVenue({
        id: 'wrong-name',
        region: '台北',
        capacityRange: '20-40',
        name: '完全不相關的名稱',
        lat: 25.033,
        lng: 121.566,
      }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({
      sort: 'distance',
      userCoords,
      region: ['台北'],
      capacityRange: '20-40',
      search: 'abc',
    });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    // 只有 region + capacityRange + search 三者都符合的兩筆進入結果，依距離排序
    expect(result.venues.map(v => v.id)).toEqual(['match-near', 'match-far']);
  });

  it('情境 7：回傳的 venue 物件不含任何新欄位（如 distanceMeters、compositeScore）', async () => {
    const venues = [buildScoredVenue({ id: 'v1', lat: 25.033, lng: 121.566, compositeScore: 0.7 })];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const result = await new VenueService().getVenues({ sort: 'distance', userCoords });
    if (Array.isArray(result)) throw new Error('expected paginated result');
    expect(Object.keys(result.venues[0]).sort()).toEqual(Object.keys(makeBaseVenue()).sort());
    expect(result.venues[0]).not.toHaveProperty('distanceMeters');
    expect(result.venues[0]).not.toHaveProperty('compositeScore');
  });

  it('sort 非 distance 時即使傳了 userCoords 也不受影響，回傳形狀與現況一致', async () => {
    const venues = [
      buildScoredVenue({ id: 'v1', compositeScore: 0.2 }),
      buildScoredVenue({ id: 'v2', compositeScore: 0.9 }),
    ];
    getWithLockSpy = jest.spyOn(cache, 'getWithLock').mockResolvedValue(venues);

    const withCoords = await new VenueService().getVenues({ sort: 'composite', userCoords });
    const withoutCoords = await new VenueService().getVenues({ sort: 'composite' });
    if (Array.isArray(withCoords) || Array.isArray(withoutCoords)) {
      throw new Error('expected paginated result');
    }
    expect(withCoords.venues.map(v => v.id)).toEqual(withoutCoords.venues.map(v => v.id));
    expect(withCoords.venues.map(v => v.id)).toEqual(['v2', 'v1']);
  });
});
