import {
  buildImportPlan,
  ExistingVenueTagFields,
  parseTagCell,
  parseTagHeader,
} from '../../src/services/venueTagImport';
import { VENUE_TAG_GROUPS, VENUE_TAGS } from '../../src/constants/venueTags';

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

// Sheet header for a dictionary slug, e.g. 價格｜免場地費 (free_venue)
const tagHeader = (slug: string) => {
  const tag = VENUE_TAGS.find(t => t.slug === slug)!;
  const group = VENUE_TAG_GROUPS.find(g => g.key === tag.group)!;
  return `${group.label}｜${tag.label} (${slug})`;
};
const ACTIVE_SLUGS = VENUE_TAGS.filter(t => t.active).map(t => t.slug);
const BASE_HEADERS = ['venue_id', '場地名稱', '整理狀態', ...ACTIVE_SLUGS.map(tagHeader)];

// Build a sheet: each row gives venue_id, status and cells keyed by slug or header name
type RowSpec = { id: string; status?: string; cells?: Record<string, string> };
const sheet = (rows: RowSpec[], headers: string[] = BASE_HEADERS): string[][] => [
  headers,
  ...rows.map(r =>
    headers.map(h => {
      if (h === 'venue_id') return r.id;
      if (h === '場地名稱') return `場地 ${r.id}`;
      if (h === '整理狀態') return r.status ?? '已確認';
      const slug = /\(([a-z_]+)\)$/.exec(h)?.[1];
      return r.cells?.[slug ?? h] ?? r.cells?.[h] ?? '';
    })
  ),
];
// Minimal valid confirmed row
const okCells = { can_decorate: 'v' };
const existing = (entries: Record<string, ExistingVenueTagFields> = {}) =>
  new Map<string, ExistingVenueTagFields>(Object.entries({ a: {}, b: {}, c: {}, ...entries }));

describe('parseTagCell', () => {
  it.each([
    ['', { ok: true, tag: null }],
    ['v', { ok: true, tag: {} }],
    ['v 限期', { ok: true, tag: { limited: true } }],
    ['v 2026-12-31', { ok: true, tag: { limited: true, until: '2026-12-31' } }],
    ['V', { ok: true, tag: {} }],
    ['v　限期', { ok: true, tag: { limited: true } }],
    ['  v  ', { ok: true, tag: {} }],
  ])('合法：%p', (cell, expected) => {
    expect(parseTagCell(cell)).toEqual(expected);
  });

  // TC-039
  it.each([['v?'], ['v？'], ['v 2026/12/31'], ['v 2026-02-31'], ['x'], ['vv']])(
    'TC-039 不合法：%p',
    cell => {
      expect(parseTagCell(cell).ok).toBe(false);
    }
  );
});

describe('parseTagHeader', () => {
  it('標準表頭 → slug', () => {
    expect(parseTagHeader('價格｜免場地費 (free_venue)')).toEqual({
      kind: 'tag',
      slug: 'free_venue',
    });
  });

  // TC-041
  it.each([
    ['價格|免場地費 (free_venue)'],
    ['價格｜免場地費（free_venue）'],
    ['價格｜免場地費(free_venue)'],
  ])('TC-041 格式錯 → malformed：%p', header => {
    expect(parseTagHeader(header).kind).toBe('malformed');
  });

  it.each([['依據（從哪裡看到）'], ['目前 hostTags'], ['原始說明連結'], ['場地名稱']])(
    'TC-041 不誤判：%p',
    header => {
      expect(parseTagHeader(header).kind).toBe('other');
    }
  );

  it('TC-041 暫緩欄先跳過、不檢查格式', () => {
    expect(parseTagHeader('（暫緩）服務｜扭蛋機（gacha）').kind).toBe('deferred');
  });
});

describe('buildImportPlan', () => {
  it('TC-005 只把「已確認」的列轉成寫入計畫，格子轉成標籤', () => {
    const plan = buildImportPlan(
      sheet([
        {
          id: 'a',
          cells: {
            ...okCells,
            goods_distribution: 'v',
            early_setup: 'v 限期',
            free_venue: 'v 2026-12-31',
          },
        },
        { id: 'b', status: ' 已確認 ', cells: okCells },
        { id: 'c', status: '整理中', cells: { ...okCells, free_venue: 'v?' } },
      ]),
      existing()
    );

    expect(plan.errors).toEqual([]);
    expect(plan.changes.map(c => c.venueId)).toEqual(['a', 'b']);
    expect(plan.changes[0].update.tags).toEqual(
      expect.arrayContaining([
        { slug: 'goods_distribution' },
        { slug: 'early_setup', limited: true },
        { slug: 'free_venue', limited: true, until: '2026-12-31' },
        { slug: 'can_decorate' },
      ])
    );
    expect(plan.stats).toEqual({ confirmed: 2, changed: 2, unchanged: 0, skipped: 1 });
  });

  it('TC-006 dry-run 輸出：+、-、~ 到期改變、附加欄位前後值', () => {
    const headers = [...BASE_HEADERS, '店家提供的設備'];
    const plan = buildImportPlan(
      sheet(
        [
          {
            id: 'a',
            cells: {
              ...okCells,
              deposit: 'v',
              free_venue: 'v 2026-12-31',
              店家提供的設備: '投影機',
            },
          },
        ],
        headers
      ),
      existing({
        a: {
          tags: [{ slug: 'can_decorate' }, { slug: 'free_venue' }, { slug: 'custom_menu' }],
          equipmentNote: '音響',
        },
      })
    );

    expect(plan.errors).toEqual([]);
    const lines = plan.changes[0].lines.join('\n');
    expect(lines).toContain('+ deposit');
    expect(lines).toContain('- custom_menu');
    expect(lines).toContain('~ free_venue: 不限期 → 至 2026-12-31');
    expect(lines).toContain('音響');
    expect(lines).toContain('投影機');
    expect(Object.keys(plan.changes[0].update).sort()).toEqual(['equipmentNote', 'tags']);
  });

  it('TC-007 冪等：順序不同、存了 limited:false，同一份 CSV 再算是 0 家有變動', () => {
    const rows = sheet([
      { id: 'a', cells: { ...okCells, private_booking: 'v', free_venue: 'v 2026-12-31' } },
    ]);
    const plan = buildImportPlan(
      rows,
      existing({
        a: {
          tags: [
            { slug: 'free_venue', limited: true, until: '2026-12-31' },
            { slug: 'private_booking', limited: false } as never,
            { slug: 'can_decorate' },
          ],
        },
      })
    );
    expect(plan.changes).toEqual([]);
    expect(plan.stats).toEqual({ confirmed: 1, changed: 0, unchanged: 1, skipped: 0 });
  });

  it('TC-049 重新匯入會蓋掉後台的修改', () => {
    const plan = buildImportPlan(
      sheet([{ id: 'a', cells: { ...okCells, free_venue: 'v' } }]),
      existing({
        a: {
          tags: [
            { slug: 'can_decorate' },
            { slug: 'free_venue', limited: true, until: '2026-12-31' },
            { slug: 'deposit' },
          ],
        },
      })
    );
    const lines = plan.changes[0].lines.join('\n');
    expect(lines).toContain('- deposit');
    expect(lines).toContain('~ free_venue: 至 2026-12-31 → 不限期');
    expect(plan.changes[0].update.tags).toEqual(
      expect.arrayContaining([{ slug: 'can_decorate' }, { slug: 'free_venue' }])
    );
    expect(plan.changes[0].update.tags).toHaveLength(2);
  });

  it('TC-039 不合法格子 → 整批拒絕，錯誤含列號、欄名、格子原文', () => {
    const plan = buildImportPlan(
      sheet([
        { id: 'a', cells: okCells },
        { id: 'b', cells: { ...okCells, free_venue: 'v?' } },
      ]),
      existing()
    );
    expect(plan.changes).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('第 3 列');
    expect(plan.errors[0]).toContain(tagHeader('free_venue'));
    expect(plan.errors[0]).toContain('v?');
  });

  it('「整理中」的列不解析格子（v? 不擋）', () => {
    const plan = buildImportPlan(
      sheet([{ id: 'a', status: '整理中', cells: { free_venue: 'v?' } }]),
      existing()
    );
    expect(plan.errors).toEqual([]);
  });

  describe('TC-040 表頭與字典對不上、表頭重複、缺必要欄', () => {
    it.each([
      ['字典沒有的 slug', [...BASE_HEADERS, '價格｜亂寫 (unknown_tag)']],
      ['active:false 的 slug', [...BASE_HEADERS, '服務｜停用 (retired_tag)']],
      ['同一 slug 兩欄、中文不同', [...BASE_HEADERS, '服務｜包場 (private_booking)']],
      ['兩欄表頭字串完全相同', [...BASE_HEADERS, tagHeader('private_booking')]],
      ['缺 venue_id', BASE_HEADERS.filter(h => h !== 'venue_id')],
      ['缺 整理狀態', BASE_HEADERS.filter(h => h !== '整理狀態')],
    ])('%s → 整批拒絕', (_name, headers) => {
      const plan = buildImportPlan(sheet([{ id: 'a', cells: okCells }], headers), existing());
      expect(plan.errors.length).toBeGreaterThan(0);
      expect(plan.changes).toEqual([]);
    });
  });

  it.each([
    ['半形 |', '價格|免場地費 (free_venue)'],
    ['全形括號', '價格｜免場地費（free_venue）'],
    ['少空白', '價格｜免場地費(free_venue)'],
  ])('TC-041 表頭格式錯（%s）→ 整批拒絕', (_name, bad) => {
    const headers = BASE_HEADERS.map(h => (h === tagHeader('free_venue') ? bad : h));
    const plan = buildImportPlan(sheet([{ id: 'a', cells: okCells }], headers), existing());
    expect(plan.errors.some(e => e.includes(bad))).toBe(true);
  });

  it('TC-041 暫緩欄與一般說明欄不擋', () => {
    const headers = [
      ...BASE_HEADERS,
      '（暫緩）服務｜扭蛋機（gacha）',
      '依據（從哪裡看到）',
      '目前 hostTags',
      '備註',
    ];
    const plan = buildImportPlan(
      sheet([{ id: 'a', cells: { ...okCells, '（暫緩）服務｜扭蛋機（gacha）': 'v?' } }], headers),
      existing()
    );
    expect(plan.errors).toEqual([]);
  });

  describe('TC-042 有佈置相關標籤但沒勾「可佈置」', () => {
    const decorRelated = [
      ...VENUE_TAGS.filter(t => t.group === 'price' && t.active).map(t => t.slug),
      'exhibition_space',
      'early_setup',
      'display_fixtures',
    ];

    it.each(decorRelated.map(s => [s]))('%s 沒有 can_decorate → 整批拒絕', slug => {
      const plan = buildImportPlan(sheet([{ id: 'a', cells: { [slug]: 'v' } }]), existing());
      expect(plan.errors).toHaveLength(1);
      expect(plan.errors[0]).toContain('第 2 列');
      expect(plan.errors[0]).toContain('can_decorate');
    });

    it.each([
      ['同列有 can_decorate', { free_venue: 'v', can_decorate: 'v' }],
      ['只有 cafe、goods_distribution', { cafe: 'v', goods_distribution: 'v' }],
    ])('對照組通過：%s', (_name, cells) => {
      expect(buildImportPlan(sheet([{ id: 'a', cells }]), existing()).errors).toEqual([]);
    });
  });

  describe('TC-043 venue_id 異常', () => {
    it.each([
      ['Firestore 找不到', [{ id: 'zzz', cells: okCells }]],
      [
        '表上兩列同一 id',
        [
          { id: 'a', cells: okCells },
          { id: 'a', cells: okCells },
        ],
      ],
      ['格子空白', [{ id: '', cells: okCells }]],
    ])('%s → 整批拒絕', (_name, rows) => {
      const plan = buildImportPlan(sheet(rows), existing());
      expect(plan.errors.length).toBeGreaterThan(0);
      expect(plan.changes).toEqual([]);
    });

    it('前後空白 trim 後正常比對', () => {
      const plan = buildImportPlan(sheet([{ id: ' a ', cells: okCells }]), existing());
      expect(plan.errors).toEqual([]);
      expect(plan.changes[0].venueId).toBe('a');
    });
  });

  const EXTRA_HEADERS = ['原始說明連結', '店家提供的設備', '資料更新日期', '檔期行事曆連結'];
  const withExtras = [...BASE_HEADERS, ...EXTRA_HEADERS];

  it.each(
    EXTRA_HEADERS.flatMap(h => [
      [h, '?'],
      [h, '？'],
    ])
  )('TC-044 附加欄位「%s」以 %s 開頭 → 整批拒絕', (header, mark) => {
    const value = header === '資料更新日期' ? `${mark}2026-10-14` : `${mark}https://a.com`;
    const plan = buildImportPlan(
      sheet([{ id: 'a', cells: { ...okCells, [header]: value } }], withExtras),
      existing()
    );
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain(header);
  });

  describe('TC-045 原始說明連結抽取與附加欄位格式', () => {
    const run = (cells: Record<string, string>) =>
      buildImportPlan(
        sheet([{ id: 'a', cells: { ...okCells, ...cells } }], withExtras),
        existing()
      );

    it.each([
      [
        'Canva：https://canva.com/a\n表單：https://forms.gle/b',
        ['https://canva.com/a', 'https://forms.gle/b'],
      ],
      ['https://forms.gle/abc（需登入）', ['https://forms.gle/abc']],
      ['https://x.com/a。', ['https://x.com/a']],
    ])('抽出網址：%p', (cell, expected) => {
      const plan = run({ 原始說明連結: cell });
      expect(plan.errors).toEqual([]);
      expect(plan.changes[0].update.sourceLinks).toEqual(expected);
    });

    it('6 個網址 → 整批拒絕', () => {
      const six = Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`).join('\n');
      expect(run({ 原始說明連結: six }).errors).toHaveLength(1);
    });

    it.each([['2026/10/15'], ['2026-02-31']])('資料更新日期 %p → 整批拒絕', value => {
      expect(run({ 資料更新日期: value }).errors).toHaveLength(1);
    });

    it('檔期行事曆連結不是 http/https → 整批拒絕', () => {
      expect(run({ 檔期行事曆連結: 'timetree 帳號 abc' }).errors).toHaveLength(1);
    });

    it('合法的日期與行事曆照寫', () => {
      const plan = run({ 資料更新日期: '2026-10-14', 檔期行事曆連結: 'https://timetree.com/x' });
      expect(plan.changes[0].update).toMatchObject({
        infoUpdatedOn: '2026-10-14',
        calendarUrl: 'https://timetree.com/x',
      });
    });
  });

  describe('TC-046 附加欄位不在表上、在表上但空白', () => {
    const current = {
      tags: [{ slug: 'can_decorate' }],
      sourceLinks: ['https://old.com'],
      equipmentNote: '音響',
    };

    it('a：表上沒有這兩欄 → 不動既有值', () => {
      const plan = buildImportPlan(sheet([{ id: 'a', cells: okCells }]), existing({ a: current }));
      expect(plan.changes).toEqual([]);
    });

    it('b：有欄但格子空白 → 清成 []、""', () => {
      const plan = buildImportPlan(
        sheet([{ id: 'a', cells: okCells }], [...BASE_HEADERS, '原始說明連結', '店家提供的設備']),
        existing({ a: current })
      );
      expect(plan.changes[0].update).toEqual({
        tags: [{ slug: 'can_decorate' }],
        sourceLinks: [],
        equipmentNote: '',
      });
    });

    it('c：equipmentNote 只有換行與空白 → 存成 ""', () => {
      const plan = buildImportPlan(
        sheet(
          [{ id: 'a', cells: { ...okCells, 店家提供的設備: ' \n \n ' } }],
          [...BASE_HEADERS, '店家提供的設備']
        ),
        existing({ a: current })
      );
      expect(plan.changes[0].update).toEqual({
        tags: [{ slug: 'can_decorate' }],
        equipmentNote: '',
      });
    });
  });

  it('TC-048 字典有、表上找不到的標籤欄 → 醒目警告，不擋', () => {
    const headers = BASE_HEADERS.filter(h => h !== tagHeader('near_train'));
    const plan = buildImportPlan(sheet([{ id: 'a', cells: okCells }], headers), existing());
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('near_train');
    expect(plan.warnings[0]).toContain('移除');
  });
});
