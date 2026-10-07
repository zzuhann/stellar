import {
  computeActiveWeeks,
  computeCompositeScore,
  computeNewVenueScore,
  computeViewCap,
  computeViewScore,
} from '../../src/services/venueService';

// Fake Timestamp-like object: just enough surface (toMillis/toDate) for computeActiveWeeks.
const ts = (ms: number) => ({
  toMillis: () => ms,
  toDate: () => new Date(ms),
});

const ref = (id: string) => ({ id }) as never;

const eventDoc = (id: string, data: Record<string, unknown> | undefined) =>
  ({
    id,
    exists: data !== undefined,
    data: () => data,
  }) as never;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe('computeActiveWeeks', () => {
  const now = Date.parse('2026-09-02T00:00:00.000Z');

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('活動剛好落在 26 週窗口起點之前 1ms → 不計入', () => {
    const cutoff = now - 26 * WEEK_MS;
    const refsByVenue = new Map([['v1', [ref('e1')]]]);
    const eventDocs = [eventDoc('e1', { status: 'approved', datetime: { start: ts(cutoff - 1) } })];

    expect(computeActiveWeeks(refsByVenue, eventDocs).get('v1')).toBe(0);
  });

  it('活動剛好落在 26 週窗口起點之後 1ms → 計入', () => {
    const cutoff = now - 26 * WEEK_MS;
    const refsByVenue = new Map([['v1', [ref('e1')]]]);
    const eventDocs = [eventDoc('e1', { status: 'approved', datetime: { start: ts(cutoff + 1) } })];

    expect(computeActiveWeeks(refsByVenue, eventDocs).get('v1')).toBe(1);
  });

  it('同一場地同一 ISO 週有 2 場活動只計 1 週', () => {
    // 2026-08-24（週一）與 2026-08-28（週五）同一 ISO 週
    const refsByVenue = new Map([['v1', [ref('e1'), ref('e2')]]]);
    const eventDocs = [
      eventDoc('e1', {
        status: 'approved',
        datetime: { start: ts(Date.parse('2026-08-24T00:00:00.000Z')) },
      }),
      eventDoc('e2', {
        status: 'approved',
        datetime: { start: ts(Date.parse('2026-08-28T00:00:00.000Z')) },
      }),
    ];

    expect(computeActiveWeeks(refsByVenue, eventDocs).get('v1')).toBe(1);
  });

  it('同一場地在不同 ISO 週各有 1 場活動 → 各自計入，週數累加', () => {
    const refsByVenue = new Map([['v1', [ref('e1'), ref('e2')]]]);
    const eventDocs = [
      eventDoc('e1', {
        status: 'approved',
        datetime: { start: ts(Date.parse('2026-08-24T00:00:00.000Z')) },
      }),
      eventDoc('e2', {
        status: 'approved',
        datetime: { start: ts(Date.parse('2026-08-31T00:00:00.000Z')) },
      }),
    ];

    expect(computeActiveWeeks(refsByVenue, eventDocs).get('v1')).toBe(2);
  });

  it('status !== approved 不計入活躍週數，即使日期落在窗口內', () => {
    const refsByVenue = new Map([['v1', [ref('e1'), ref('e2')]]]);
    const eventDocs = [
      eventDoc('e1', { status: 'pending', datetime: { start: ts(now) } }),
      eventDoc('e2', { status: 'rejected', datetime: { start: ts(now) } }),
    ];

    expect(computeActiveWeeks(refsByVenue, eventDocs).get('v1')).toBe(0);
  });

  it('venue.eventRefs 為空陣列 → activeWeeksScore 為 0，不報錯', () => {
    const refsByVenue = new Map([['v1', []]]);
    expect(() => computeActiveWeeks(refsByVenue, [])).not.toThrow();
    expect(computeActiveWeeks(refsByVenue, []).get('v1')).toBe(0);
  });

  it('eventRefs 中的活動 document 在 batch get 時找不到（已被刪除）→ 忽略該筆，不影響其餘活動計算', () => {
    const refsByVenue = new Map([['v1', [ref('deleted'), ref('e2')]]]);
    const eventDocs = [
      eventDoc('deleted', undefined), // exists: false
      eventDoc('e2', { status: 'approved', datetime: { start: ts(now) } }),
    ];

    expect(() => computeActiveWeeks(refsByVenue, eventDocs)).not.toThrow();
    expect(computeActiveWeeks(refsByVenue, eventDocs).get('v1')).toBe(1);
  });
});

describe('computeNewVenueScore（新場地加分衰減公式邊界）', () => {
  it('weeksSinceCreated = 6 → newVenueScore = 1（保護期滿分邊界）', () => {
    expect(computeNewVenueScore(6)).toBe(1);
  });

  it('weeksSinceCreated = 7 → newVenueScore = 0.5（線性衰減中點）', () => {
    expect(computeNewVenueScore(7)).toBe(0.5);
  });

  it('weeksSinceCreated = 8 → newVenueScore = 0（保護期結束邊界，含）', () => {
    expect(computeNewVenueScore(8)).toBe(0);
  });

  it('weeksSinceCreated = 5.9 → newVenueScore clamp 為 1（未滿 6 週維持滿分）', () => {
    expect(computeNewVenueScore(5.9)).toBe(1);
  });

  it('weeksSinceCreated = 8.5（超過保護期）→ newVenueScore = 0（clamp 不為負值）', () => {
    expect(computeNewVenueScore(8.5)).toBe(0);
  });
});

describe('computeViewCap（viewCap = max(30, P90)，P90 取升冪 index floor(0.9n)）', () => {
  it('空陣列 → viewCap = 30', () => {
    expect(computeViewCap([])).toBe(30);
  });

  it('全部瀏覽數為 0 → viewCap = 30，viewScore 為 0 且 compositeScore 無 NaN / Infinity', () => {
    const cap = computeViewCap([0, 0, 0, 0]);
    expect(cap).toBe(30);
    expect(computeViewScore(0, cap)).toBe(0);
    const score = computeCompositeScore(10, 0, 10, cap);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('P90 < 30（10 個場地皆 ≤ 10）→ 下限生效 viewCap = 30', () => {
    expect(computeViewCap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(30);
  });

  it('P90 = 30 → viewCap = 30（邊界）', () => {
    expect(computeViewCap([0, 0, 0, 0, 0, 0, 0, 0, 0, 30])).toBe(30);
  });

  it('P90 > 30（10 個場地 0..90 → P90 = 90）→ viewCap = P90', () => {
    expect(computeViewCap([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])).toBe(90);
  });

  it('n = 1：views = 500 → 500；views = 5 → 30', () => {
    expect(computeViewCap([500])).toBe(500);
    expect(computeViewCap([5])).toBe(30);
  });

  it('n = 11 含離群值 5000：index = 9，取第 10 小的值，不被離群值拉高', () => {
    const views = [5000, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5];
    expect(computeViewCap(views)).toBe(50);
  });

  it('未排序、含重複值 → 結果正確，且不 mutate 傳入陣列', () => {
    const input = [100, 40, 40, 100, 40, 100, 40, 100, 40, 100];
    const snapshot = [...input];
    expect(computeViewCap(input)).toBe(100);
    expect(input).toEqual(snapshot);
  });

  it('以數值排序而非字典序（[9, 10, 100] 不被排成 [10, 100, 9]）', () => {
    // 字典序排成 [10, 100, 9] 會取到 9 → 下限 30；數值排序取 100
    expect(computeViewCap([9, 10, 100])).toBe(100);
  });
});

describe('computeViewScore(recentViews, viewCap)', () => {
  it('recentViews = 0 → viewScore = 0', () => {
    expect(computeViewScore(0, 300)).toBe(0);
  });

  it('viewCap = 300、recentViews = 150 → viewScore = 0.5', () => {
    expect(computeViewScore(150, 300)).toBe(0.5);
  });

  it('recentViews = viewCap → viewScore = 1（cap 邊界）', () => {
    expect(computeViewScore(300, 300)).toBe(1);
  });

  it('recentViews > viewCap（5000 對 90）→ clamp 為 1', () => {
    expect(computeViewScore(5000, 90)).toBe(1);
  });

  it('同一 recentViews，viewCap 較大者 viewScore 較小', () => {
    expect(computeViewScore(50, 200)).toBeLessThan(computeViewScore(50, 100));
  });
});

describe('computeCompositeScore（綜合分數計算與加權方向）', () => {
  it('activeWeeks=13、recentViews=viewCap/2、weeksSinceCreated=10 → 0.375', () => {
    // 0.5 * 0.45 + 0.5 * 0.3 + 0 * 0.25
    expect(computeCompositeScore(13, 50, 10, 100)).toBeCloseTo(0.375, 10);
  });

  it('三維度皆滿分 → 1.0', () => {
    expect(computeCompositeScore(26, 100, 0, 100)).toBeCloseTo(1.0, 10);
  });

  it('權重鎖定：僅活躍度滿分 0.45、僅瀏覽滿分 0.3、僅新場地滿分 0.25', () => {
    expect(computeCompositeScore(26, 0, 100, 100)).toBeCloseTo(0.45, 10);
    expect(computeCompositeScore(0, 100, 100, 100)).toBeCloseTo(0.3, 10);
    expect(computeCompositeScore(0, 0, 0, 100)).toBeCloseTo(0.25, 10);
  });

  it('三維度皆為 0 → 0', () => {
    expect(computeCompositeScore(0, 0, 100, 100)).toBe(0);
  });

  it('相同活躍週數與新場地加分，recentViews 較高者分數較高', () => {
    const lower = computeCompositeScore(10, 50, 10, 300);
    const higher = computeCompositeScore(10, 200, 10, 300);
    expect(higher).toBeGreaterThan(lower);
  });

  it('相同瀏覽數與新場地加分，activeWeeks 較高者分數較高', () => {
    const lower = computeCompositeScore(5, 100, 10, 300);
    const higher = computeCompositeScore(20, 100, 10, 300);
    expect(higher).toBeGreaterThan(lower);
  });
});
