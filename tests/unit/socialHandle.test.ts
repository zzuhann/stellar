import { normalizeSocialHandles } from '../../src/utils/socialHandle';
import { eventSchemas, venueSchemas } from '../../src/middleware/validation';

describe('normalizeSocialHandles', () => {
  test.each([
    ['@ FROZENHEART.CO', 'FROZENHEART.CO'],
    ['@name', 'name'],
    ['name', 'name'],
    ['@@name', 'name'],
    ['  @name  ', 'name'],
    ['@', ''],
    ['@ ', ''],
    ['', ''],
    ['@a, @ b', 'a, b'],
    ['a,b', 'a, b'],
    ['a,,b', 'a, b'],
    ['@, a', 'a'],
    // Anything beyond leading @ / whitespace per comma item is stored as-is (no guessing)
    ['https://www.threads.com/@mpe7889', 'https://www.threads.com/@mpe7889'],
    ['@yyuuu._.tk @at.3.33.am', 'yyuuu._.tk @at.3.33.am'],
    ['knock_onedoor/ yuchieh', 'knock_onedoor/ yuchieh'],
    ['@a、@b', 'a、@b'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeSocialHandles(input)).toBe(expected);
  });
});

describe('event schema social handle cleanup', () => {
  const eventBase = {
    title: '測試活動',
    location: { name: '測試地點', coordinates: { lat: 25.03, lng: 121.56 } },
    datetime: {
      start: { _seconds: 1700000000, _nanoseconds: 0 },
      end: { _seconds: 1700003600, _nanoseconds: 0 },
    },
    artistIds: ['artist-1'],
  };

  it('cleans instagram on create', () => {
    const result = eventSchemas.create.safeParse({
      ...eventBase,
      socialMedia: { instagram: '@ my_account' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.socialMedia.instagram).toBe('my_account');
  });

  it('rejects when the only handle is a bare @', () => {
    const result = eventSchemas.create.safeParse({
      ...eventBase,
      socialMedia: { instagram: '@' },
    });
    expect(result.success).toBe(false);
  });
});

describe('venue schema social handle cleanup', () => {
  const venueBase = {
    name: '測試場地',
    address: '台北市測試路 1 號',
    region: '台北',
    capacityRange: '20-40',
    coverPhoto: 'https://example.com/cover.jpg',
    preferredContact: 'instagram',
  };

  it('cleans instagram but keeps line url untouched', () => {
    const result = venueSchemas.create.safeParse({
      ...venueBase,
      socialMedia: { instagram: '@ my_account', line: 'https://line.me/ti/p/@abc' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.socialMedia.instagram).toBe('my_account');
      expect(result.data.socialMedia.line).toBe('https://line.me/ti/p/@abc');
    }
  });

  it('rejects when the only handle is a bare @', () => {
    const result = venueSchemas.create.safeParse({
      ...venueBase,
      socialMedia: { instagram: '@' },
    });
    expect(result.success).toBe(false);
  });
});

describe('venue update schema socialMedia', () => {
  it('rejects update whose only handle is a bare @', () => {
    expect(venueSchemas.update.safeParse({ socialMedia: { instagram: '@' } }).success).toBe(false);
  });

  it('allows partial update without socialMedia', () => {
    expect(venueSchemas.update.safeParse({ name: '新名稱' }).success).toBe(true);
  });
});
