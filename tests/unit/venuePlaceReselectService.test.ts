import { FieldValue } from 'firebase-admin/firestore';
import * as service from '../../src/services/venuePlaceReselectService';
import { cache } from '../../src/utils/cache';

type Doc = Record<string, unknown>;
type Coll = 'venues' | 'coffeeEvents';

interface FakeRef {
  id: string;
  path: string;
  get: () => Promise<unknown>;
}

interface FakeQuery {
  kind: 'query';
  coll: Coll;
  field: string;
  get: () => Promise<unknown>;
  limit: (n: number) => FakeQuery;
}

const store: Record<Coll, Record<string, Doc>> = { venues: {}, coffeeEvents: {} };
let txReads: string[] = [];
let txOps: string[] = [];
let committed: Array<{ path: string; payload: Doc }> = [];
let updateCalls = 0;
let failOnUpdateNumber: number | null = null;
let beforeTx: (() => void) | null = null;

const mockRunTransaction = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: (name: string) => mockCollection(name),
    runTransaction: (fn: unknown) => mockRunTransaction(fn),
  },
}));

const getPath = (data: Doc, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (acc as Doc | undefined)?.[key], data);

const makeSnap = (coll: Coll, id: string) => ({
  id,
  exists: id in store[coll],
  ref: makeRef(coll, id),
  data: () => store[coll][id],
});

function makeRef(coll: Coll, id: string): FakeRef {
  return { id, path: `${coll}/${id}`, get: () => Promise.resolve(makeSnap(coll, id)) };
}

function makeQuery(coll: Coll, field: string, value: unknown, max = Infinity): FakeQuery {
  return {
    kind: 'query',
    coll,
    field,
    limit: n => makeQuery(coll, field, value, n),
    get: () => {
      const docs = Object.keys(store[coll])
        .filter(id => getPath(store[coll][id], field) === value)
        .slice(0, max)
        .map(id => makeSnap(coll, id));
      return Promise.resolve({ size: docs.length, empty: docs.length === 0, docs });
    },
  };
}

function mockCollection(name: string) {
  const coll = name as Coll;
  return {
    doc: (id: string) => makeRef(coll, id),
    where: (field: string, _op: string, value: unknown) => makeQuery(coll, field, value),
  };
}

mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
  beforeTx?.();
  const pending: Array<{ path: string; payload: Doc }> = [];
  const tx = {
    get: async (target: FakeRef | FakeQuery) => {
      txOps.push('get');
      txReads.push('kind' in target ? `${target.coll}:${target.field}` : target.path);
      return target.get();
    },
    update: (ref: FakeRef, payload: Doc) => {
      updateCalls += 1;
      if (failOnUpdateNumber === updateCalls) throw new Error('tx update failed');
      txOps.push('update');
      pending.push({ path: ref.path, payload });
    },
  };
  const result = await fn(tx);
  committed.push(...pending);
  return result;
});

const VENUE_ID = 'venue-1';
const PLACE = 'ChIJnewPlaceId123456';
const eventRef = (id: string) => makeRef('coffeeEvents', id);

function seedVenue(overrides: Doc = {}, id = VENUE_ID) {
  store.venues[id] = {
    name: '浪漫島 咖啡',
    address: '台北市中正區A路1號',
    placeId: '',
    lat: 0,
    lng: 0,
    region: '台北',
    nearestMrt: '台大醫院',
    status: 'active',
    eventRefs: [],
    eventCount: 0,
    ...overrides,
  };
}

function seedEvent(
  id: string,
  overrides: { status?: string; placeId?: string; venueId?: unknown } = {}
) {
  const location: Doc = { placeId: overrides.placeId ?? PLACE };
  if ('venueId' in overrides) location.venueId = overrides.venueId;
  store.coffeeEvents[id] = {
    title: `title-${id}`,
    status: overrides.status ?? 'approved',
    location,
  };
}

interface GoogleBody {
  id?: string;
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  types?: string[];
}

const googleOk = (overrides: GoogleBody = {}): GoogleBody => ({
  id: PLACE,
  location: { latitude: 25.04, longitude: 121.56 },
  formattedAddress: '106台灣台北市中正區A路1號',
  types: ['cafe', 'establishment'],
  ...overrides,
});

const mockFetch = jest.fn();
const respond = (body: GoogleBody, status = 200) => {
  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  );
};

const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;
let deleteSpy: jest.SpyInstance;
let clearPatternSpy: jest.SpyInstance;

beforeAll(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  process.env.GOOGLE_MAPS_API_KEY = originalKey;
});

beforeEach(() => {
  store.venues = {};
  store.coffeeEvents = {};
  txReads = [];
  txOps = [];
  committed = [];
  updateCalls = 0;
  failOnUpdateNumber = null;
  beforeTx = null;
  mockRunTransaction.mockClear();
  mockFetch.mockReset();
  respond(googleOk());
  deleteSpy = jest.spyOn(cache, 'delete');
  clearPatternSpy = jest.spyOn(cache, 'clearPattern');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const venueUpdate = () => committed.find(w => w.path === `venues/${VENUE_ID}`)?.payload;
const eventUpdates = () => committed.filter(w => w.path.startsWith('coffeeEvents/'));
const idsOf = (list: Array<{ id: string }>) => list.map(e => e.id).sort();
const noCacheCleared = () => {
  expect(deleteSpy).not.toHaveBeenCalled();
  expect(clearPatternSpy).not.toHaveBeenCalled();
};

describe('B4 補連對象判定', () => {
  it('只補連 approved、placeId 相符、venueId 為空的活動', async () => {
    seedVenue();
    seedEvent('ok-missing');
    seedEvent('ok-null', { venueId: null });
    seedEvent('ok-empty', { venueId: '' });
    seedEvent('pending', { status: 'pending' });
    seedEvent('rejected', { status: 'rejected' });
    seedEvent('other-place', { placeId: 'ChIJotherPlace12345' });
    seedEvent('other-venue', { venueId: 'venue-9' });

    const result = await service.apply(VENUE_ID, PLACE);

    const linked = ['ok-empty', 'ok-missing', 'ok-null'];
    expect(idsOf(result.linkedEvents)).toEqual(linked);
    expect(result.linkedCount).toBe(3);
    expect(
      eventUpdates()
        .map(w => w.path)
        .sort()
    ).toEqual(linked.map(id => `coffeeEvents/${id}`));
    eventUpdates().forEach(w => expect(w.payload).toEqual({ 'location.venueId': VENUE_ID }));
    const refs = (venueUpdate()!.eventRefs as FakeRef[]).map(r => r.path).sort();
    expect(refs).toEqual(linked.map(id => `coffeeEvents/${id}`));
  });
});

describe('B5 已連此場地的活動保留且 eventRefs 去重', () => {
  it('不 update 已連活動、保留其 ref，並以 path 去重', async () => {
    seedEvent('linked', {
      placeId: 'ChIJdifferentPlace123',
      venueId: VENUE_ID,
      status: 'approved',
    });
    seedEvent('new1');
    seedVenue({ eventRefs: [eventRef('linked'), eventRef('new1')], eventCount: 2 });

    const result = await service.apply(VENUE_ID, PLACE);

    expect(eventUpdates().map(w => w.path)).toEqual(['coffeeEvents/new1']);
    expect(result.linkedCount).toBe(1);
    const payload = venueUpdate()!;
    expect((payload.eventRefs as FakeRef[]).map(r => r.path).sort()).toEqual([
      'coffeeEvents/linked',
      'coffeeEvents/new1',
    ]);
    expect(payload.eventCount).toBe(2);
  });
});

describe('B6 新 placeId 被他場地使用', () => {
  beforeEach(() => {
    seedVenue();
    seedVenue({ name: '被占用的場地', placeId: PLACE, lat: 25, lng: 121 }, 'venue-2');
    seedEvent('e1');
  });

  it.each(['preview', 'apply'] as const)(
    '%s 回 409 PLACE_ID_IN_USE 且帶場地 id、name',
    async fn => {
      await expect(service[fn](VENUE_ID, PLACE)).rejects.toMatchObject({
        statusCode: 409,
        code: 'PLACE_ID_IN_USE',
        details: { venue: { id: 'venue-2', name: '被占用的場地' } },
      });
      expect(committed).toEqual([]);
    }
  );
});

describe('B7 唯一性在 transaction 內', () => {
  it('preview 時無人占用、apply 的 transaction 內有人占用 -> 409 且無寫入', async () => {
    seedVenue();
    seedEvent('e1');
    await expect(service.preview(VENUE_ID, PLACE)).resolves.toBeDefined();

    beforeTx = () => seedVenue({ name: '搶先的場地', placeId: PLACE }, 'venue-2');

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PLACE_ID_IN_USE',
    });
    expect(committed).toEqual([]);
  });

  it('唯一性與候選活動查詢都走 tx.get，且所有讀在所有寫之前', async () => {
    seedVenue();
    seedEvent('e1');

    await service.apply(VENUE_ID, PLACE);

    expect(txReads).toEqual(
      expect.arrayContaining([
        `venues/${VENUE_ID}`,
        'venues:placeId',
        'coffeeEvents:location.placeId',
      ])
    );
    const firstUpdate = txOps.indexOf('update');
    expect(firstUpdate).toBeGreaterThan(-1);
    expect(txOps.slice(firstUpdate)).not.toContain('get');
  });
});

describe('B8 placeId 與自身相同仍可套用', () => {
  it.each([
    ['有 2 筆可補連', 2],
    ['沒有可補連', 0],
  ])('%s', async (_label, n) => {
    seedVenue({ placeId: PLACE, lat: 0, lng: 0 });
    for (let i = 0; i < n; i++) seedEvent(`e${i}`);

    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.unchanged).toBe(true);
    expect(preview.linkableEventCount).toBe(n);

    const result = await service.apply(VENUE_ID, PLACE);
    expect(result.lat).toBe(25.04);
    expect(result.lng).toBe(121.56);
    expect(result.linkedCount).toBe(n);
    expect(venueUpdate()).toMatchObject({ placeId: PLACE, lat: 25.04, lng: 121.56 });
  });
});

describe('B9 Google 失敗或無座標不寫入', () => {
  const failures: Array<[string, () => void, string]> = [
    ['HTTP 非 ok', () => respond({}, 500), 'PLACE_LOOKUP_FAILED'],
    [
      'fetch 一直 throw',
      () => mockFetch.mockRejectedValue(new TypeError('fetch failed')),
      'PLACE_LOOKUP_FAILED',
    ],
    ['缺 lat', () => respond(googleOk({ location: { longitude: 121.5 } })), 'PLACE_NO_COORDINATES'],
    ['缺 lng', () => respond(googleOk({ location: { latitude: 25 } })), 'PLACE_NO_COORDINATES'],
    [
      'lat、lng 皆 0',
      () => respond(googleOk({ location: { latitude: 0, longitude: 0 } })),
      'PLACE_NO_COORDINATES',
    ],
    ['缺 location', () => respond(googleOk({ location: undefined })), 'PLACE_NO_COORDINATES'],
  ];

  it.each(failures)('%s', async (_label, setup, code) => {
    seedVenue();
    seedEvent('e1');
    setup();

    await expect(service.preview(VENUE_ID, PLACE)).rejects.toMatchObject({
      statusCode: 422,
      code,
    });
    await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({ statusCode: 422, code });

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
    expect(store.venues[VENUE_ID].placeId).toBe('');
  });

  it('單邊為 0（lat=0, lng=121.5）視為有效座標', async () => {
    seedVenue();
    respond(googleOk({ location: { latitude: 0, longitude: 121.5 } }));

    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.google).toMatchObject({ lat: 0, lng: 121.5 });

    const result = await service.apply(VENUE_ID, PLACE);
    expect(venueUpdate()).toMatchObject({ lat: 0, lng: 121.5 });
    expect(result.lng).toBe(121.5);
  });
});

describe('B10 地址決策', () => {
  const current = '台北市中正區A路1號';
  const different = '台北市信義區B路99號';

  it('(a) 正規化相同：保留現有字串，不寫 address，即使帶了 addressChoice', async () => {
    seedVenue({ address: current });
    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.address).toMatchObject({ sameAfterNormalize: true, choiceRequired: false });

    const result = await service.apply(VENUE_ID, PLACE, 'google');
    expect(venueUpdate()).not.toHaveProperty('address');
    expect(result.address).toBe(current);
  });

  it.each([
    ['空字串', ''],
    ['僅空白', '   '],
    ['缺欄位', undefined],
  ])('(b) 現有地址為%s：採用 Google 地址，不需選擇', async (_label, address) => {
    seedVenue({ address });
    if (address === undefined) delete store.venues[VENUE_ID].address;
    respond(googleOk({ formattedAddress: different }));

    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.address.choiceRequired).toBe(false);

    const result = await service.apply(VENUE_ID, PLACE);
    expect(venueUpdate()).toMatchObject({ address: different });
    expect(result.address).toBe(different);
  });

  describe('不同地址', () => {
    beforeEach(() => {
      seedVenue({ address: current });
      respond(googleOk({ formattedAddress: different }));
    });

    it('preview 要求選擇', async () => {
      const preview = await service.preview(VENUE_ID, PLACE);
      expect(preview.address).toEqual({
        current,
        google: different,
        sameAfterNormalize: false,
        choiceRequired: true,
      });
    });

    it('(c) 未帶 addressChoice -> 400 ADDRESS_CHOICE_REQUIRED，無寫入', async () => {
      await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({
        statusCode: 400,
        code: 'ADDRESS_CHOICE_REQUIRED',
      });
      expect(committed).toEqual([]);
    });

    it('(d) existing：不寫 address', async () => {
      const result = await service.apply(VENUE_ID, PLACE, 'existing');
      expect(venueUpdate()).not.toHaveProperty('address');
      expect(result.address).toBe(current);
    });

    it('(e) google：寫入 Google 地址', async () => {
      const result = await service.apply(VENUE_ID, PLACE, 'google');
      expect(venueUpdate()).toMatchObject({ address: different });
      expect(result.address).toBe(different);
    });
  });
});

describe('B10 Google 地址為空：保留現有地址', () => {
  const current = '台北市中正區A路1號';

  it.each([
    ['空字串', ''],
    ['僅空白', '   '],
    ['缺欄位', undefined],
  ])('Google 地址%s：不要求選擇，apply 帶 google 也不改寫 address', async (_label, formatted) => {
    seedVenue({ address: current });
    respond(googleOk({ formattedAddress: formatted }));

    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.address.choiceRequired).toBe(false);
    expect(preview.address.current).toBe(current);

    const result = await service.apply(VENUE_ID, PLACE, 'google');
    expect(venueUpdate()).not.toHaveProperty('address');
    expect(result.address).toBe(current);
  });

  it('現有與 Google 皆空：不寫入 address', async () => {
    seedVenue({ address: '' });
    respond(googleOk({ formattedAddress: '' }));

    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.address.choiceRequired).toBe(false);

    const result = await service.apply(VENUE_ID, PLACE);
    expect(venueUpdate()).not.toHaveProperty('address');
    expect(result.address).toBe('');
  });
});

describe('B11 其他欄位不動', () => {
  it('payload 只含 placeId、lat、lng、eventRefs、eventCount、updatedAt', async () => {
    seedVenue();

    await service.apply(VENUE_ID, PLACE);

    const payload = venueUpdate()!;
    expect(Object.keys(payload).sort()).toEqual(
      ['eventCount', 'eventRefs', 'lat', 'lng', 'placeId', 'updatedAt'].sort()
    );
    expect(payload.updatedAt).toEqual(FieldValue.serverTimestamp());
  });

  it('選 google 地址時多一個 address，仍不含 region、nearestMrt、status', async () => {
    seedVenue({ address: '' });

    await service.apply(VENUE_ID, PLACE);

    const keys = Object.keys(venueUpdate()!);
    expect(keys).toContain('address');
    ['region', 'nearestMrt', 'status'].forEach(key => expect(keys).not.toContain(key));
  });
});

describe('B12 原子性', () => {
  it('tx.update 中途拋錯：錯誤向上傳、無提交、不清快取', async () => {
    seedVenue();
    seedEvent('e1');
    seedEvent('e2');
    failOnUpdateNumber = 2;

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toThrow('tx update failed');

    expect(committed).toEqual([]);
    noCacheCleared();
  });

  it('tx 內讀取拋錯：錯誤向上傳、不清快取', async () => {
    seedVenue();
    mockRunTransaction.mockImplementationOnce(() => Promise.reject(new Error('read failed')));

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toThrow('read failed');
    noCacheCleared();
  });
});

describe('B13 / B14 候選上限', () => {
  const seedMany = (n: number) => {
    for (let i = 0; i < n; i++) seedEvent(`e${i}`);
  };

  it('B13 apply 候選 401 筆 -> 422 TOO_MANY_LINKABLE_EVENTS，無寫入', async () => {
    seedVenue();
    seedMany(401);

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({
      statusCode: 422,
      code: 'TOO_MANY_LINKABLE_EVENTS',
      details: { linkableEventCount: 401 },
    });
    expect(committed).toEqual([]);
  });

  it('B14 preview 候選 401 筆 -> 422 並帶實際總數', async () => {
    seedVenue();
    seedMany(401);

    await expect(service.preview(VENUE_ID, PLACE)).rejects.toMatchObject({
      statusCode: 422,
      code: 'TOO_MANY_LINKABLE_EVENTS',
      details: { linkableEventCount: 401 },
    });
  });

  it('B14 preview 剛好 400 筆正常回傳', async () => {
    seedVenue();
    seedMany(400);

    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.linkableEventCount).toBe(400);
  });
});

describe('B15 preview 名單上限與共用過濾', () => {
  it('(a) 150 筆候選：名單 100、總數 150', async () => {
    seedVenue();
    for (let i = 0; i < 150; i++) seedEvent(`e${i}`);

    const preview = await service.preview(VENUE_ID, PLACE);

    expect(preview.linkableEvents).toHaveLength(100);
    expect(preview.linkableEventCount).toBe(150);
  });

  it('(b) 混合資料：preview 與 apply 名單相同', async () => {
    seedVenue();
    seedEvent('ok1');
    seedEvent('ok2', { venueId: null });
    seedEvent('pending', { status: 'pending' });
    seedEvent('other-venue', { venueId: 'venue-9' });
    seedEvent('linked-here', { venueId: VENUE_ID });

    const preview = await service.preview(VENUE_ID, PLACE);
    const result = await service.apply(VENUE_ID, PLACE);

    expect(idsOf(preview.linkableEvents)).toEqual(['ok1', 'ok2']);
    expect(idsOf(result.linkedEvents)).toEqual(idsOf(preview.linkableEvents));
    expect(preview.linkableEvents[0]).toHaveProperty('title');
  });
});

describe('B16 apply 回報實際補連數', () => {
  it('preview 3 筆、transaction 內只剩 2 筆 -> linkedCount 2', async () => {
    seedVenue();
    seedEvent('e1');
    seedEvent('e2');
    seedEvent('e3');
    const preview = await service.preview(VENUE_ID, PLACE);
    expect(preview.linkableEventCount).toBe(3);

    beforeTx = () => {
      store.coffeeEvents.e3.status = 'pending';
    };
    const result = await service.apply(VENUE_ID, PLACE);

    expect(result.linkedCount).toBe(2);
    expect(idsOf(result.linkedEvents)).toEqual(['e1', 'e2']);
    expect(
      eventUpdates()
        .map(w => w.path)
        .sort()
    ).toEqual(['coffeeEvents/e1', 'coffeeEvents/e2']);
  });
});

describe('B17 快取', () => {
  it('apply 成功清除所有相關 key', async () => {
    seedVenue();
    seedEvent('e1');

    await service.apply(VENUE_ID, PLACE);

    expect(deleteSpy).toHaveBeenCalledWith('venues:all');
    expect(deleteSpy).toHaveBeenCalledWith(`venue:detail:${VENUE_ID}`);
    expect(deleteSpy).toHaveBeenCalledWith(`venue:admin:detail:${VENUE_ID}`);
    expect(clearPatternSpy).toHaveBeenCalledWith('admin:venues:');
    expect(clearPatternSpy).toHaveBeenCalledWith('event:');
    expect(clearPatternSpy).toHaveBeenCalledWith('events:');
  });

  it('Google 失敗不清快取、不開 transaction', async () => {
    seedVenue();
    respond({}, 500);

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({ statusCode: 422 });

    expect(mockRunTransaction).not.toHaveBeenCalled();
    noCacheCleared();
  });

  it('409 不清快取', async () => {
    seedVenue();
    seedVenue({ placeId: PLACE }, 'venue-2');

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({ statusCode: 409 });
    noCacheCleared();
  });

  it('400 ADDRESS_CHOICE_REQUIRED 不清快取', async () => {
    seedVenue({ address: '台北市信義區B路99號' });

    await expect(service.apply(VENUE_ID, PLACE)).rejects.toMatchObject({ statusCode: 400 });
    noCacheCleared();
  });

  it('preview 成功不清快取、不寫入、不開 transaction', async () => {
    seedVenue();
    seedEvent('e1');

    await service.preview(VENUE_ID, PLACE);

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
    noCacheCleared();
  });

  it('preview 失敗不清快取', async () => {
    seedVenue();
    seedVenue({ placeId: PLACE }, 'venue-2');

    await expect(service.preview(VENUE_ID, PLACE)).rejects.toMatchObject({ statusCode: 409 });
    noCacheCleared();
  });
});

describe('B19 場地不存在（service 層）', () => {
  it.each(['preview', 'apply'] as const)('%s 回 404 VENUE_NOT_FOUND', async fn => {
    await expect(service[fn]('missing', PLACE)).rejects.toMatchObject({
      statusCode: 404,
      code: 'VENUE_NOT_FOUND',
    });
    expect(committed).toEqual([]);
  });
});

describe('preview 回應內容', () => {
  it('回傳 Google 資料與地址型判斷，不採用 Google 回傳的 id', async () => {
    seedVenue();
    respond(googleOk({ id: 'EjSomeAddressId' }));

    const preview = await service.preview(VENUE_ID, 'EjAddressTypePlace123');

    expect(preview.placeId).toBe('EjAddressTypePlace123');
    expect(preview.google.isAddressType).toBe(true);
    expect(preview.google.formattedAddress).toBe('106台灣台北市中正區A路1號');
    expect(preview.unchanged).toBe(false);
  });
});
