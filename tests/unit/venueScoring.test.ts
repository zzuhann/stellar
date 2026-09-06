import {
  computeActiveWeeks,
  computeCompositeScore,
  computeNewVenueScore,
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

describe('computeViewScore（VIEW_SCORE_CAP = 300）', () => {
  it('recentViews = 0 → viewScore = 0', () => {
    expect(computeViewScore(0)).toBe(0);
  });

  it('recentViews = 150 → viewScore = 0.5', () => {
    expect(computeViewScore(150)).toBe(0.5);
  });

  it('recentViews = 300 → viewScore = 1（cap 邊界）', () => {
    expect(computeViewScore(300)).toBe(1);
  });

  it('recentViews = 5000（離群值）→ viewScore clamp 為 1，不超過 1', () => {
    expect(computeViewScore(5000)).toBe(1);
  });

  it('沒有任何 venueViewDaily bucket（recentViews = 0）→ 不報錯', () => {
    expect(() => computeViewScore(0)).not.toThrow();
    expect(computeViewScore(0)).toBe(0);
  });
});

describe('computeCompositeScore（綜合分數計算與加權方向）', () => {
  it('activeWeeks=13、recentViews=150、weeksSinceCreated=10 → compositeScore 精確等於 0.4', () => {
    // 0.5(活躍週數) * 0.5 + 0.5(瀏覽數) * 0.3 + 0(新場地，已出保護期) * 0.2 = 0.4
    expect(computeCompositeScore(13, 150, 10)).toBeCloseTo(0.4, 10);
  });

  it('三維度皆滿分 → compositeScore = 1.0', () => {
    expect(computeCompositeScore(26, 300, 0)).toBeCloseTo(1.0, 10);
  });

  it('三維度皆為 0 → compositeScore = 0', () => {
    expect(computeCompositeScore(0, 0, 100)).toBe(0);
  });

  it('相同活躍週數與新場地加分，recentViews 較高者 compositeScore 較高', () => {
    const lower = computeCompositeScore(10, 50, 10);
    const higher = computeCompositeScore(10, 200, 10);
    expect(higher).toBeGreaterThan(lower);
  });

  it('相同瀏覽數與新場地加分，activeWeeks 較高者 compositeScore 較高', () => {
    const lower = computeCompositeScore(5, 100, 10);
    const higher = computeCompositeScore(20, 100, 10);
    expect(higher).toBeGreaterThan(lower);
  });
});
