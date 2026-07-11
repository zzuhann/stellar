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
