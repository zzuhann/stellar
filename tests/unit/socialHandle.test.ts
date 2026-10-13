import { normalizeSocialHandles, parseSocialHandles } from '../../src/utils/socialHandle';
import { eventSchemas, venueSchemas } from '../../src/middleware/validation';

describe('normalizeSocialHandles', () => {
  test.each([
    ['@ FROZENHEART.CO', 'FROZENHEART.CO'],
    ['@name', 'name'],
    ['name', 'name'],
    ['@@name', 'name'],
    ['@ @name', 'name'],
    ['@', ''],
    ['@ ', ''],
    ['', ''],
    ['@a, @ b', 'a, b'],
    ['a,,b', 'a, b'],
    ['@, a', 'a'],
    ['@yyuuu._.tk @at.3.33.am', 'yyuuu._.tk, at.3.33.am'],
    ['@cute._.babygyu / @young2_tuan', 'cute._.babygyu, young2_tuan'],
    ['knock_onedoor/ yuchieh_apple860924', 'knock_onedoor, yuchieh_apple860924'],
    ['@17hanwonuuu___、@with1996__', '17hanwonuuu___, with1996__'],
    ['https://www.threads.com/@mpe7889', 'mpe7889'],
    ['https://www.instagram.com/xxx/', 'xxx'],
    ['https://www.instagram.com/xxx?igsh=abc', 'xxx'],
    ['instagram.com/xxx?igsh=abc', 'xxx'],
    ['https://www.threads.com/@a, @b', 'a, b'],
    ['𝙮𝙤𝙪𝙧._.𝙡𝙞𝙩𝙩𝙡𝙚.𝙖𝙣𝙜𝙚𝙡 ', '𝙮𝙤𝙪𝙧._.𝙡𝙞𝙩𝙩𝙡𝙚.𝙖𝙣𝙜𝙚𝙡'],
    [
      'https://www.instagram.com/p/DWTvn3bkooB/?igsh=abc',
      'https://www.instagram.com/p/DWTvn3bkooB/?igsh=abc',
    ],
    ['  https://www.instagram.com/reel/abc123/ ', 'https://www.instagram.com/reel/abc123/'],
    ['a, https://www.instagram.com/p/abc/', 'a, https://www.instagram.com/p/abc/'],
    ['https://www.instagram.com/stories/abc/123', 'abc'],
    ['https://www.threads.com/@user/post/xyz123', 'user'],
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
      socialMedia: { instagram: '@ 帳號' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.socialMedia.instagram).toBe('帳號');
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
      socialMedia: { instagram: '@ 帳號', line: 'https://line.me/ti/p/@abc' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.socialMedia.instagram).toBe('帳號');
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

describe('parseSocialHandles', () => {
  it('returns null for unresolvable post URLs', () => {
    expect(parseSocialHandles('https://www.instagram.com/p/abc/')).toBeNull();
  });
  it('returns cleaned value otherwise', () => {
    expect(parseSocialHandles('@a')).toBe('a');
  });
});
