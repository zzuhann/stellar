import { venueSchemas } from '../../src/middleware/validation';

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
