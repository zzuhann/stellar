import {
  computeEventTimeStatus,
  filterVisibleTags,
  mapAnswersToSuggestedTags,
} from '../../src/services/venueTags';
import { TransitStop, VenueConditionAnswers, VenueTag } from '../../src/models/types';

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

describe('mapAnswersToSuggestedTags（TC-072）', () => {
  // 只勾 A 的代發，C、D 用不會撞到其他列的選項
  const base: VenueConditionAnswers = {
    uses: { options: ['goods_distribution'] },
    services: { options: ['parcel_receiving'] },
    spaceTypes: { options: ['cafe'] },
  };
  const baseTags = [
    { slug: 'goods_distribution', source: 'store' },
    { slug: 'parcel_receiving', source: 'store' },
    { slug: 'cafe', source: 'store' },
  ];
  const map = (
    answers: Partial<VenueConditionAnswers>,
    ctx: { transitStops?: TransitStop[] } = {}
  ) => mapAnswersToSuggestedTags({ ...base, ...answers }, ctx);
  const slugs = (answers: Partial<VenueConditionAnswers>, ctx = {}) =>
    map(answers, ctx).map(t => t.slug);

  it('A、C、D、E 勾的選項 → 同名 slug、source: store', () => {
    expect(
      map({
        uses: { options: ['goods_distribution', 'private_booking'] },
        services: { options: ['parcel_receiving', 'custom_menu', 'beginner_friendly'] },
        spaceTypes: { options: ['bar', 'multi_space'] },
        equipment: ['projector', 'sound_system'],
      })
    ).toEqual([
      { slug: 'goods_distribution', source: 'store' },
      { slug: 'private_booking', source: 'store' },
      { slug: 'parcel_receiving', source: 'store' },
      { slug: 'custom_menu', source: 'store' },
      { slug: 'beginner_friendly', source: 'store' },
      { slug: 'bar', source: 'store' },
      { slug: 'multi_space', source: 'store' },
      { slug: 'projector', source: 'store' },
      { slug: 'sound_system', source: 'store' },
    ]);
  });

  const decorate = (fees: VenueConditionAnswers['fees']): Partial<VenueConditionAnswers> => ({
    uses: { options: ['can_decorate'] },
    fees,
  });
  const feeTags = (fees: VenueConditionAnswers['fees']) =>
    map(decorate(fees)).filter(t => !['can_decorate', 'parcel_receiving', 'cafe'].includes(t.slug));

  it.each([
    ['venueFee: free（不限期）', { venueFee: 'free' }, [{ slug: 'free_venue', source: 'store' }]],
    [
      'venueFee: free＋freeVenueLimited',
      { venueFee: 'free', freeVenueLimited: true },
      [{ slug: 'free_venue', limited: true, source: 'store' }],
    ],
    [
      'venueFee: free＋日期',
      { venueFee: 'free', freeVenueLimited: true, freeVenueUntil: '2026-12-31' },
      [{ slug: 'free_venue', limited: true, until: '2026-12-31', source: 'store' }],
    ],
    [
      'venueFee: free＋只有日期（沒有 freeVenueLimited）',
      { venueFee: 'free', freeVenueUntil: '2026-12-31' },
      [{ slug: 'free_venue', limited: true, until: '2026-12-31', source: 'store' }],
    ],
    ['venueFee: paid', { venueFee: 'paid' }, [{ slug: 'venue_fee', source: 'store' }]],
    [
      'venueFee: depends → 不限期的 free_venue＋venue_fee',
      { venueFee: 'depends' },
      [
        { slug: 'free_venue', source: 'store' },
        { slug: 'venue_fee', source: 'store' },
      ],
    ],
    ['guarantee: yes', { guarantee: 'yes' }, [{ slug: 'needs_guarantee', source: 'store' }]],
    ['guarantee: no', { guarantee: 'no' }, [{ slug: 'no_min_guarantee', source: 'store' }]],
    ['deposit: yes', { deposit: 'yes' }, [{ slug: 'deposit', source: 'store' }]],
    ['deposit: no → 不產生', { deposit: 'no' }, []],
    ['discussable → 不產生', { discussable: true }, []],
  ] as const)('B %s', (_name, fees, expected) => {
    expect(feeTags(fees as VenueConditionAnswers['fees'])).toEqual(expected);
  });

  it('discussable（A、C）與 note 不產生標籤', () => {
    expect(
      map({
        uses: { options: ['goods_distribution'], discussable: true },
        services: { options: ['parcel_receiving'], discussable: true },
        note: '可租扭蛋機',
      })
    ).toEqual(baseTags);
  });

  it.each([
    ['C 勾 early_setup', { services: { options: ['early_setup' as const] } }],
    ['E 勾 display_fixtures', { equipment: ['display_fixtures' as const] }],
  ])('%s、A 沒勾 can_decorate → can_decorate 為 auto', (_name, answers) => {
    const decorateTags = map(answers).filter(t => t.slug === 'can_decorate');
    expect(decorateTags).toEqual([{ slug: 'can_decorate', source: 'auto' }]);
  });

  it('A 有勾 can_decorate、C 勾 early_setup、E 勾 display_fixtures → 只有一個 store 的 can_decorate', () => {
    const decorateTags = map({
      uses: { options: ['can_decorate'] },
      fees: { discussable: true },
      services: { options: ['early_setup'] },
      equipment: ['display_fixtures'],
    }).filter(t => t.slug === 'can_decorate');
    expect(decorateTags).toEqual([{ slug: 'can_decorate', source: 'store' }]);
  });

  it('結果依 slug 去重（重複的選項只出現一次）', () => {
    const result = slugs({
      uses: { options: ['goods_distribution', 'goods_distribution'] },
      equipment: ['projector', 'projector'],
    });
    expect(result).toEqual([...new Set(result)]);
    expect(result.filter(s => s === 'goods_distribution')).toHaveLength(1);
    expect(result.filter(s => s === 'projector')).toHaveLength(1);
  });

  describe('交通（§10.4）', () => {
    const stop = (type: TransitStop['type'], walkMinutes: number | null): TransitStop => ({
      type,
      station: '某站',
      walkMinutes,
    });
    const transitTags = (transitStops?: TransitStop[]) =>
      map({}, { transitStops }).filter(t => t.slug === 'near_mrt' || t.slug === 'near_train');

    it.each([
      ['捷運 0 分', [stop('mrt', 0)], ['near_mrt']],
      ['捷運 10 分', [stop('mrt', 10)], ['near_mrt']],
      ['捷運 11 分', [stop('mrt', 11)], []],
      ['捷運 walkMinutes: null', [stop('mrt', null)], []],
      ['輕軌 5 分', [stop('light_rail', 5)], ['near_mrt']],
      ['公車 5 分', [stop('bus', 5)], []],
      ['火車 0 分', [stop('train', 0)], ['near_train']],
      ['火車 10 分', [stop('train', 10)], ['near_train']],
      ['高鐵 0 分', [stop('hsr', 0)], ['near_train']],
      ['高鐵 10 分', [stop('hsr', 10)], ['near_train']],
      ['步行 999 分', [stop('mrt', 999), stop('train', 999)], []],
      [
        '混合：捷運 20＋輕軌 5＋火車 5',
        [stop('mrt', 20), stop('light_rail', 5), stop('train', 5)],
        ['near_mrt', 'near_train'],
      ],
      ['兩筆合格的捷運 → 只有一個 near_mrt', [stop('mrt', 3), stop('mrt', 8)], ['near_mrt']],
    ])('%s', (_name, transitStops, expected) => {
      const tags = transitTags(transitStops as TransitStop[]);
      expect(tags.map(t => t.slug)).toEqual(expected);
      for (const tag of tags) expect(tag).toEqual({ slug: tag.slug, source: 'auto' });
    });

    it('沒帶 transitStops → 兩個都沒有（route 層另測 payload 帶 nearestMrt 時也不退回讀舊欄位）', () => {
      expect(transitTags(undefined)).toEqual([]);
      expect(slugs({})).not.toContain('near_mrt');
      expect(slugs({})).not.toContain('near_train');
    });
  });
});
