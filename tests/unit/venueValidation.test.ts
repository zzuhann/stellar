import { venueSchemas } from '../../src/middleware/validation';

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

const regionSchema = venueSchemas.create.shape.region;

describe('venue region validation', () => {
  test.each([
    ['台北', '台北'],
    ['臺北', '台北'],
    ['臺中', '台中'],
    ['臺南', '台南'],
    ['臺東', '台東'],
  ])('accepts "%s" and normalizes to "%s"', (input, expected) => {
    const result = regionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(expected);
  });

  it('rejects invalid region', () => {
    expect(regionSchema.safeParse('東京').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(regionSchema.safeParse('').success).toBe(false);
  });
});

describe('public venue submission validation', () => {
  const base = {
    name: '測試場地',
    address: '台北市測試路 1 號',
    region: '台北',
    capacityRange: '20-40',
    coverPhoto: 'https://example.com/cover.jpg',
    preferredContact: 'instagram',
    socialMedia: { instagram: 'venue' },
  } as const;

  it('requires a preferred contact method when creating a venue', () => {
    expect(
      venueSchemas.create.safeParse({
        name: base.name,
        address: base.address,
        region: base.region,
        capacityRange: base.capacityRange,
        coverPhoto: base.coverPhoto,
        socialMedia: base.socialMedia,
      }).success
    ).toBe(false);
  });

  it('requires capacity range and a cover photo when creating a venue', () => {
    expect(venueSchemas.create.safeParse({ ...base, capacityRange: undefined }).success).toBe(
      false
    );
    expect(venueSchemas.create.safeParse({ ...base, coverPhoto: undefined }).success).toBe(false);
  });

  it('requires Instagram or Threads and does not accept Line alone', () => {
    expect(venueSchemas.create.safeParse({ ...base, socialMedia: undefined }).success).toBe(false);
    expect(
      venueSchemas.create.safeParse({ ...base, socialMedia: { line: '@venue' } }).success
    ).toBe(false);
    expect(
      venueSchemas.create.safeParse({ ...base, socialMedia: { instagram: '   ' } }).success
    ).toBe(false);
    expect(
      venueSchemas.create.safeParse({ ...base, socialMedia: { threads: '@venue' } }).success
    ).toBe(true);
  });

  it('strips system-managed fields', () => {
    const result = venueSchemas.create.parse({
      ...base,
      status: 'active',
      eventCount: 99,
      eventRefs: ['event-1'],
      createdBy: 'attacker',
    });

    expect(result).toEqual({
      name: '測試場地',
      address: '台北市測試路 1 號',
      region: '台北',
      capacityRange: '20-40',
      coverPhoto: 'https://example.com/cover.jpg',
      preferredContact: 'instagram',
      socialMedia: { instagram: 'venue' },
    });
  });

  it('rejects more photos or tags than the form allows', () => {
    expect(
      venueSchemas.create.safeParse({
        ...base,
        otherPhotos: Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`),
      }).success
    ).toBe(false);
    expect(
      venueSchemas.create.safeParse({
        ...base,
        hostTags: Array.from({ length: 6 }, (_, i) => `tag-${i}`),
      }).success
    ).toBe(false);
  });
});

describe('GET /venues query validation (venueSchemas.getVenues)', () => {
  const parse = (query: Record<string, unknown>) => venueSchemas.getVenues.safeParse(query);

  it('accepts an empty query and defaults everything to undefined', () => {
    const result = parse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ search: undefined });
    }
  });

  it.each(['20以下', '20-40', '40-60', '60以上'])('accepts capacityRange=%s', value => {
    expect(parse({ capacityRange: value }).success).toBe(true);
  });

  it('rejects an invalid capacityRange with the existing error message', () => {
    const result = parse({ capacityRange: '100以上' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'capacityRange must be one of: 20以下, 20-40, 40-60, 60以上'
      );
    }
  });

  it.each(['composite', 'eventCount', 'name', 'newest', 'random'])('accepts sort=%s', value => {
    // random 模式下 limit 為必填，補上以孤立測試 sort 本身的合法性
    expect(parse({ sort: value, limit: value === 'random' ? '10' : undefined }).success).toBe(true);
  });

  it('rejects an invalid sort with the existing error message', () => {
    const result = parse({ sort: 'popularity' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'sort must be "composite", "eventCount", "name", "newest", "random", or "distance"'
      );
    }
  });

  it.each(['active', 'inactive', 'pending', 'rejected', 'all'])('accepts status=%s', value => {
    expect(parse({ status: value }).success).toBe(true);
  });

  it('rejects an invalid status with the existing error message', () => {
    const result = parse({ status: 'archived' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'status must be one of: active, inactive, pending, rejected, all'
      );
    }
  });

  it('requires limit when sort=random', () => {
    const result = parse({ sort: 'random' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('limit is required when sort is "random"');
    }
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects limit=%s as not a positive integer', limitValue => {
    const result = parse({ sort: 'random', limit: limitValue });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('limit must be a positive integer');
    }
  });

  it('accepts a positive integer limit and coerces it to a number', () => {
    const result = parse({ limit: '20' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it.each(['0', '-1', 'abc', '1.5'])(
    'silently drops an invalid page=%s to undefined instead of erroring',
    pageValue => {
      const result = parse({ page: pageValue });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.page).toBeUndefined();
    }
  );

  it('accepts a positive integer page and coerces it to a number', () => {
    const result = parse({ page: '3' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.page).toBe(3);
  });

  it('trims search and drops it to undefined when blank', () => {
    const trimmed = parse({ search: '  abc mart  ' });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.search).toBe('abc mart');

    const blank = parse({ search: '   ' });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.search).toBeUndefined();
  });

  it('accepts region as a single value or an array', () => {
    expect(parse({ region: '台北' }).success).toBe(true);
    expect(parse({ region: ['台北', '新北'] }).success).toBe(true);
  });

  it('normalizes 臺 to 台 for both single-value and array region', () => {
    const single = parse({ region: '臺北' });
    expect(single.success).toBe(true);
    if (single.success) expect(single.data.region).toBe('台北');

    const array = parse({ region: ['臺北', '臺南'] });
    expect(array.success).toBe(true);
    if (array.success) expect(array.data.region).toEqual(['台北', '台南']);
  });

  it('rejects an invalid single-value region (previously fell through as "valid")', () => {
    expect(parse({ region: '東京' }).success).toBe(false);
    expect(parse({ region: 'not-a-real-region' }).success).toBe(false);
  });

  it('rejects an array region containing any invalid value', () => {
    expect(parse({ region: ['台北', '東京'] }).success).toBe(false);
  });
});

// --- 場地距離最近排序（sort=distance）--------------------------------------
// 對應 specs/features/venue-distance-sort/qa.md 後端情境 8-11

describe('GET /venues query validation — sort=distance (venueSchemas.getVenues)', () => {
  const parse = (query: Record<string, unknown>) => venueSchemas.getVenues.safeParse(query);

  it('情境 8：sort=distance ＋ 合法座標通過', () => {
    const result = parse({ sort: 'distance', lat: '25.03', lng: '121.56' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lat).toBe(25.03);
      expect(result.data.lng).toBe(121.56);
    }
  });

  it('情境 9：sort=distance 缺 lng 時失敗', () => {
    expect(parse({ sort: 'distance', lng: '121.56' }).success).toBe(false);
  });

  it('情境 9：sort=distance 缺 lat 時失敗', () => {
    expect(parse({ sort: 'distance', lat: '25.03' }).success).toBe(false);
  });

  it('情境 9：sort=distance 兩者皆缺時失敗', () => {
    expect(parse({ sort: 'distance' }).success).toBe(false);
  });

  it('情境 9：sort=distance ＋ lat 為空字串時失敗（不可被 Number() 誤轉為 0）', () => {
    expect(parse({ sort: 'distance', lat: '', lng: '121.56' }).success).toBe(false);
  });

  it('情境 9：sort=distance ＋ lat 為純空白字串時失敗', () => {
    expect(parse({ sort: 'distance', lat: '   ', lng: '121.56' }).success).toBe(false);
  });

  it('情境 9：sort=distance ＋ lng 為空字串時失敗', () => {
    expect(parse({ sort: 'distance', lat: '25.03', lng: '' }).success).toBe(false);
  });

  it('情境 9 反向案例：sort=composite ＋ lat 為空字串時仍通過，且 parse 結果不含 lat/lng', () => {
    const result = parse({ sort: 'composite', lat: '', lng: '121.56' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('lat');
      expect(result.data).not.toHaveProperty('lng');
    }
  });

  it('情境 9 反向案例：sort=composite ＋ lat 為非數字字串時仍通過，且 parse 結果不含 lat', () => {
    const result = parse({ sort: 'composite', lat: 'abc' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('lat');
    }
  });

  it.each([
    ['lat', 90],
    ['lat', -90],
    ['lng', 180],
    ['lng', -180],
  ])('情境 10：%s=%s（合法邊界）通過', (key, value) => {
    const other = key === 'lat' ? { lng: '121' } : { lat: '25' };
    const result = parse({ sort: 'distance', [key]: String(value), ...other });
    expect(result.success).toBe(true);
  });

  it.each([
    ['lat', 90.0001],
    ['lat', -90.0001],
    ['lng', 180.0001],
    ['lng', -180.0001],
  ])('情境 10：%s=%s（超出邊界）失敗', (key, value) => {
    const other = key === 'lat' ? { lng: '121' } : { lat: '25' };
    const result = parse({ sort: 'distance', [key]: String(value), ...other });
    expect(result.success).toBe(false);
  });

  it('情境 11：lat 為完全非數字字串（"abc"）時失敗', () => {
    expect(parse({ sort: 'distance', lat: 'abc', lng: '121.56' }).success).toBe(false);
  });

  it('情境 11：lat 為部分數字字串（"25.03abc"）時失敗', () => {
    expect(parse({ sort: 'distance', lat: '25.03abc', lng: '121.56' }).success).toBe(false);
  });

  it('accepts sort=distance in the existing sort enum list', () => {
    expect(parse({ sort: 'distance', lat: '25', lng: '121' }).success).toBe(true);
  });
});

describe('venue submission error messages (Traditional Chinese)', () => {
  const base = {
    name: '測試場地',
    address: '台北市測試路 1 號',
    region: '台北',
    capacityRange: '20-40',
    coverPhoto: 'https://example.com/cover.jpg',
    preferredContact: 'instagram',
    socialMedia: { instagram: 'venue' },
  } as const;

  const URL_MESSAGE = '請輸入完整網址（以 http:// 或 https:// 開頭）';

  const firstIssue = (schema: 'create' | 'update', input: Record<string, unknown>) => {
    const result = venueSchemas[schema].safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    return result.error.issues[0];
  };

  describe.each(['create', 'update'] as const)('contactUrl (%s)', schema => {
    it.each(['@abc123', 'line.me/xxx', 'javascript:alert(1)', 'ftp://x'])(
      'rejects "%s" with the URL message on contactUrl',
      value => {
        const issue = firstIssue(schema, { ...base, contactUrl: value });
        expect(issue.message).toBe(URL_MESSAGE);
        expect(issue.path).toEqual(['contactUrl']);
      }
    );

    it('accepts an https URL', () => {
      expect(
        venueSchemas[schema].safeParse({ ...base, contactUrl: 'https://line.me/ti/p/xxx' }).success
      ).toBe(true);
    });

    it('rejects a URL longer than 500 chars with a Chinese message', () => {
      const issue = firstIssue(schema, {
        ...base,
        contactUrl: `https://example.com/${'a'.repeat(500)}`,
      });
      expect(issue.message).toBe('網址不能超過 500 個字');
      expect(issue.path).toEqual(['contactUrl']);
    });
  });

  it.each([
    ['name', { name: 'a'.repeat(201) }, '場地名稱不能超過 200 個字'],
    ['address', { address: 'a'.repeat(501) }, '地址不能超過 500 個字'],
    ['description', { description: 'a'.repeat(3001) }, '場地介紹不能超過 3000 個字'],
    ['nearestMrt', { nearestMrt: 'a'.repeat(101) }, '最近捷運站不能超過 100 個字'],
    ['mrtWalkMinutes', { mrtWalkMinutes: -1 }, '步行分鐘數必須是 0 以上的整數'],
    ['region', { region: '東京' }, '請選擇有效的地區'],
    ['capacityRange', { capacityRange: '100以上' }, '請選擇有效的容納人數範圍'],
    ['preferredContact', { preferredContact: 'fax' }, '請選擇有效的預約聯絡方式'],
    ['hostTags', { hostTags: ['a'.repeat(51)] }, '每個場地標籤不能超過 50 個字'],
    [
      'socialMedia.instagram',
      { socialMedia: { instagram: 'a'.repeat(501) } },
      '社群帳號不能超過 500 個字',
    ],
  ])('create: %s has a Chinese message', (_field, override, message) => {
    expect(firstIssue('create', { ...base, ...override }).message).toBe(message);
  });

  it('update: status enum has a Chinese message', () => {
    expect(firstIssue('update', { status: 'pending' }).message).toBe('請選擇有效的場地狀態');
  });

  describe('contactUrl edge cases', () => {
    const ok = (schema: 'create' | 'update', contactUrl: unknown) =>
      venueSchemas[schema].safeParse({ ...base, contactUrl }).success;

    it.each(['create', 'update'] as const)('(%s) accepts http:// and omitted value', schema => {
      expect(ok(schema, 'http://example.com')).toBe(true);
      expect(ok(schema, undefined)).toBe(true);
    });

    it.each(['create', 'update'] as const)('(%s) rejects null, empty and blank', schema => {
      expect(firstIssue(schema, { ...base, contactUrl: null }).message).toBe(
        '預約表單連結格式不正確'
      );
      expect(firstIssue(schema, { ...base, contactUrl: '' }).message).toBe(URL_MESSAGE);
      expect(firstIssue(schema, { ...base, contactUrl: '   ' }).message).toBe(URL_MESSAGE);
    });

    it.each(['create', 'update'] as const)('(%s) enforces the 500 char boundary', schema => {
      const prefix = 'https://example.com/';
      expect(ok(schema, prefix + 'a'.repeat(500 - prefix.length))).toBe(true);
      expect(ok(schema, prefix + 'a'.repeat(501 - prefix.length))).toBe(false);
    });

    it('keeps legacy behavior: trailing whitespace is trimmed by .url() before max', () => {
      expect(ok('create', `https://example.com${' '.repeat(600)}`)).toBe(true);
    });
  });

  describe('missing and wrong-type values', () => {
    it.each([
      ['name', { name: undefined }, '請填寫場地名稱'],
      ['address', { address: undefined }, '請填寫地址'],
      ['coverPhoto', { coverPhoto: undefined }, '請上傳封面照片'],
      ['region', { region: undefined }, '請選擇有效的地區'],
      ['capacityRange', { capacityRange: undefined }, '請選擇有效的容納人數範圍'],
      ['preferredContact', { preferredContact: undefined }, '請選擇有效的預約聯絡方式'],
      ['socialMedia', { socialMedia: undefined }, '請填寫社群帳號'],
      ['mrtWalkMinutes', { mrtWalkMinutes: '5' }, '步行分鐘數必須是數字'],
      ['lat', { lat: '25' }, '緯度必須是數字'],
      ['description', { description: 5 }, '場地介紹格式不正確'],
      ['hostTags', { hostTags: 'a' }, '場地標籤格式不正確'],
      ['otherPhotos', { otherPhotos: 'x' }, '照片格式不正確'],
    ])('create: %s', (_f, override, message) => {
      expect(firstIssue('create', { ...base, ...override }).message).toBe(message);
    });

    it('update: wrong types give Chinese messages', () => {
      expect(firstIssue('update', { name: 5 }).message).toBe('場地名稱格式不正確');
      expect(firstIssue('update', { mrtWalkMinutes: '5' }).message).toBe('步行分鐘數必須是數字');
      expect(firstIssue('update', { socialMedia: 'x' }).message).toBe('請填寫社群帳號');
    });
  });
});

describe('venue tag fields (venue-tags)', () => {
  const parseUpdate = (body: unknown) => venueSchemas.update.safeParse(body);
  const venueBase = {
    name: '測試場地',
    address: '台北市測試路 1 號',
    region: '台北',
    capacityRange: '20-40',
    coverPhoto: 'https://example.com/cover.jpg',
    preferredContact: 'instagram',
    socialMedia: { instagram: 'venue' },
  } as const;

  describe('TC-068 update schema 的 tags', () => {
    it.each([
      ['未知 slug', [{ slug: 'unknown_tag' }]],
      ['active:false', [{ slug: 'retired_tag' }]],
      ['重複 slug', [{ slug: 'free_venue' }, { slug: 'free_venue', limited: true }]],
      ['有 until 沒有 limited', [{ slug: 'free_venue', until: '2026-12-31' }]],
      ['until 不存在的日期', [{ slug: 'free_venue', limited: true, until: '2026-02-31' }]],
      ['until 格式錯', [{ slug: 'free_venue', limited: true, until: '2026/12/31' }]],
    ])('400：%s', (_name, tags) => {
      expect(parseUpdate({ tags }).success).toBe(false);
    });

    it.each([
      ['until 是過去日期', [{ slug: 'free_venue', limited: true, until: '2020-01-01' }]],
      ['tags: []', []],
    ])('通過：%s', (_name, tags) => {
      const result = parseUpdate({ tags });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual(tags);
    });

    it('limited:false 存檔時被拿掉', () => {
      const result = parseUpdate({ tags: [{ slug: 'private_booking', limited: false }] });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual([{ slug: 'private_booking' }]);
    });
  });

  describe('TC-069 其他新欄位的 schema', () => {
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${i}`);

    it('sourceLinks：6 個 → 400；5 個通過；空字串被濾掉；[] 通過', () => {
      expect(parseUpdate({ sourceLinks: urls(6) }).success).toBe(false);
      expect(parseUpdate({ sourceLinks: urls(5) }).success).toBe(true);
      const filtered = parseUpdate({ sourceLinks: ['', 'https://a.com', ''] });
      expect(filtered.success && filtered.data.sourceLinks).toEqual(['https://a.com']);
      const empty = parseUpdate({ sourceLinks: [] });
      expect(empty.success && empty.data.sourceLinks).toEqual([]);
    });

    it.each([['javascript:alert(1)'], [`https://example.com/${'a'.repeat(500)}`]])(
      'sourceLinks 不合法：%s',
      link => {
        expect(parseUpdate({ sourceLinks: [link] }).success).toBe(false);
      }
    );

    it.each([[''], [null]])('calendarUrl %p → null', value => {
      const result = parseUpdate({ calendarUrl: value });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.calendarUrl).toBeNull();
    });

    it('calendarUrl 不是 http/https → 400', () => {
      expect(parseUpdate({ calendarUrl: 'ftp://example.com' }).success).toBe(false);
    });

    it('equipmentNote：trim；空字串通過；1001 字 400；含價格通過', () => {
      const trimmed = parseUpdate({ equipmentNote: '  扭蛋機\n燈板  ' });
      expect(trimmed.success && trimmed.data.equipmentNote).toBe('扭蛋機\n燈板');
      const empty = parseUpdate({ equipmentNote: '' });
      expect(empty.success && empty.data.equipmentNote).toBe('');
      expect(parseUpdate({ equipmentNote: 'a'.repeat(1001) }).success).toBe(false);
      expect(parseUpdate({ equipmentNote: '燈板租借 $300' }).success).toBe(true);
    });

    it('infoUpdatedOn：null 通過；合法日期通過；2026-13-01 → 400', () => {
      expect(parseUpdate({ infoUpdatedOn: null }).success).toBe(true);
      expect(parseUpdate({ infoUpdatedOn: '2026-10-15' }).success).toBe(true);
      expect(parseUpdate({ infoUpdatedOn: '2026-13-01' }).success).toBe(false);
    });
  });

  it('create（admin）接受五個新欄位', () => {
    const result = venueSchemas.create.safeParse({
      ...venueBase,
      tags: [{ slug: 'free_venue', limited: true, until: '2026-12-31' }],
      sourceLinks: ['https://a.com'],
      equipmentNote: '投影機',
      infoUpdatedOn: '2026-10-15',
      calendarUrl: 'https://calendar.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        tags: [{ slug: 'free_venue', limited: true, until: '2026-12-31' }],
        sourceLinks: ['https://a.com'],
        equipmentNote: '投影機',
        infoUpdatedOn: '2026-10-15',
        calendarUrl: 'https://calendar.example.com',
      });
    }
  });

  it('createSubmission（匿名投稿）靜默丟掉五個正式欄位，hostTags 照收', () => {
    const result = venueSchemas.createSubmission.safeParse({
      ...venueBase,
      hostTags: ['大空間'],
      tags: [{ slug: 'free_venue' }],
      sourceLinks: ['https://a.com'],
      equipmentNote: '投影機',
      infoUpdatedOn: '2026-10-15',
      calendarUrl: 'https://calendar.example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hostTags).toEqual(['大空間']);
      for (const key of ['tags', 'sourceLinks', 'equipmentNote', 'infoUpdatedOn', 'calendarUrl']) {
        expect(result.data).not.toHaveProperty(key);
      }
    }
  });
});

describe('venue tag URL fields: trim and messages', () => {
  it('sourceLinks、calendarUrl 前後空白先 trim 再驗證', () => {
    const result = venueSchemas.update.safeParse({
      sourceLinks: [' https://a.com ', '   '],
      calendarUrl: ' https://cal.example.com ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceLinks).toEqual(['https://a.com']);
      expect(result.data.calendarUrl).toBe('https://cal.example.com');
    }
    const blank = venueSchemas.update.safeParse({ calendarUrl: '   ' });
    expect(blank.success && blank.data.calendarUrl).toBeNull();
  });

  it('calendarUrl 型別錯誤的訊息指向行事曆，不是預約表單', () => {
    const result = venueSchemas.update.safeParse({ calendarUrl: 123 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe('行事曆連結格式不正確');
  });
});
