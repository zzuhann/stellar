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

  it.each(['eventCount', 'name', 'newest', 'random'])('accepts sort=%s', value => {
    // random 模式下 limit 為必填，補上以孤立測試 sort 本身的合法性
    expect(parse({ sort: value, limit: value === 'random' ? '10' : undefined }).success).toBe(true);
  });

  it('rejects an invalid sort with the existing error message', () => {
    const result = parse({ sort: 'popularity' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'sort must be "eventCount", "name", "newest", or "random"'
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
});
