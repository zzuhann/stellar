import { eventSchemas } from '../../src/middleware/validation';

const baseCreatePayload = {
  title: '測試活動',
  location: {
    name: '測試地點',
    coordinates: { lat: 25.03, lng: 121.56 },
  },
  datetime: {
    start: { _seconds: 1700000000, _nanoseconds: 0 },
    end: { _seconds: 1700003600, _nanoseconds: 0 },
  },
  artistIds: ['artist-1'],
  socialMedia: { instagram: 'foo' },
} as const;

describe('eventSchemas.create reservation validation', () => {
  it('accepts a payload with no reservation field', () => {
    const result = eventSchemas.create.safeParse(baseCreatePayload);
    expect(result.success).toBe(true);
  });

  it('accepts reservation with only url', () => {
    const result = eventSchemas.create.safeParse({
      ...baseCreatePayload,
      reservation: { url: 'https://example.com/reserve' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts reservation with url and startAt', () => {
    const result = eventSchemas.create.safeParse({
      ...baseCreatePayload,
      reservation: {
        url: 'http://example.com/reserve',
        startAt: { _seconds: 1699999999, _nanoseconds: 0 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects reservation with startAt but no url', () => {
    const result = eventSchemas.create.safeParse({
      ...baseCreatePayload,
      reservation: {
        startAt: { _seconds: 1699999999, _nanoseconds: 0 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['reservation', 'url']);
    }
  });

  test.each([
    ['not-a-url', 'plain string'],
    ['javascript:alert(1)', 'javascript: protocol'],
    ['ftp://example.com/file', 'ftp: protocol'],
    ['data:text/html,hello', 'data: protocol'],
  ])('rejects url "%s" (%s)', url => {
    const result = eventSchemas.create.safeParse({
      ...baseCreatePayload,
      reservation: { url },
    });
    expect(result.success).toBe(false);
  });

  test.each(['https://example.com/reserve', 'http://example.com/reserve'])(
    'accepts url "%s"',
    url => {
      const result = eventSchemas.create.safeParse({
        ...baseCreatePayload,
        reservation: { url },
      });
      expect(result.success).toBe(true);
    }
  );
});

describe('eventSchemas.update reservation validation', () => {
  const baseUpdatePayload = { title: '更新標題' };

  it('accepts omitted reservation (leaves existing value untouched)', () => {
    const result = eventSchemas.update.safeParse(baseUpdatePayload);
    expect(result.success).toBe(true);
  });

  it('accepts reservation: null (explicit clear)', () => {
    const result = eventSchemas.update.safeParse({
      ...baseUpdatePayload,
      reservation: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts reservation: {} (both fields empty)', () => {
    const result = eventSchemas.update.safeParse({
      ...baseUpdatePayload,
      reservation: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full reservation object', () => {
    const result = eventSchemas.update.safeParse({
      ...baseUpdatePayload,
      reservation: {
        url: 'https://example.com/reserve',
        startAt: { _seconds: 1699999999, _nanoseconds: 0 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects reservation with startAt but no url', () => {
    const result = eventSchemas.update.safeParse({
      ...baseUpdatePayload,
      reservation: {
        startAt: { _seconds: 1699999999, _nanoseconds: 0 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['reservation', 'url']);
    }
  });
});
