import { computeEventTimeStatus, filterVisibleTags } from '../../src/services/venueTags';
import { VenueTag } from '../../src/models/types';

jest.mock('../../src/constants/venueTags', () => {
  const actual = jest.requireActual('../../src/constants/venueTags');
  return {
    ...actual,
    VENUE_TAGS: [
      ...actual.VENUE_TAGS,
      { slug: 'retired_tag', group: 'service', label: '停用', order: 99, active: false },
    ],
  };
});

describe('filterVisibleTags（TC-027）', () => {
  const today = '2026-10-15';

  it.each([
    ['until 當天顯示', [{ slug: 'free_venue', limited: true, until: '2026-10-15' }], true],
    ['until 前一天不顯示', [{ slug: 'free_venue', limited: true, until: '2026-10-14' }], false],
    ['limited 沒有 until 顯示', [{ slug: 'free_venue', limited: true }], true],
    ['不限期顯示', [{ slug: 'free_venue' }], true],
    ['字典沒有的 slug 不顯示', [{ slug: 'unknown_tag' }], false],
    ['active:false 不顯示', [{ slug: 'retired_tag' }], false],
  ])('%s', (_name, tags, visible) => {
    expect(filterVisibleTags(tags as VenueTag[], today)).toEqual(visible ? tags : []);
  });

  it('[] → []；欄位不存在 → []', () => {
    expect(filterVisibleTags([], today)).toEqual([]);
    expect(filterVisibleTags(undefined, today)).toEqual([]);
  });

  it('不改動傳入的陣列', () => {
    const tags = [{ slug: 'free_venue', limited: true as const, until: '2026-10-14' }];
    filterVisibleTags(tags, today);
    expect(tags).toHaveLength(1);
  });
});

describe('computeEventTimeStatus（TC-030）', () => {
  // 活動開始存台北 00:00、結束存台北 23:59:59，API 輸出 UTC ISO
  const start = '2026-10-15T16:00:00.000Z'; // 台北 10/16
  const end = '2026-10-20T15:59:59.000Z'; // 台北 10/20

  it.each([
    ['2026-10-15', 'upcoming'],
    ['2026-10-16', 'ongoing'],
    ['2026-10-20', 'ongoing'],
    ['2026-10-21', 'ended'],
  ])('today=%s → %s', (today, expected) => {
    expect(computeEventTimeStatus(start, end, today)).toBe(expected);
  });

  it('startDate 空 → null', () => {
    expect(computeEventTimeStatus('', end, '2026-10-16')).toBeNull();
  });

  it('endDate 空 → null（防呆）', () => {
    expect(computeEventTimeStatus(start, '', '2026-10-16')).toBeNull();
  });
});
