jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

import dns from 'dns';
import {
  assertSafePublicUrl,
  fetchWithSsrfGuard,
  isPrivateOrReservedIp,
} from '../../src/utils/ssrfGuard';

const mockLookup = dns.promises.lookup as jest.Mock;

describe('isPrivateOrReservedIp', () => {
  test.each([
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true], // 雲端 metadata endpoint
    ['0.0.0.0', true],
  ])('%s 判定為私有／保留 IP', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  test.each([
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['142.250.206.14', false],
  ])('%s 判定為公開 IP', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  // CIDR 邊界：172.16.0.0/12 涵蓋 172.16.0.0 ~ 172.31.255.255
  test('172.15.255.255（範圍外一格）判定為公開', () => {
    expect(isPrivateOrReservedIp('172.15.255.255')).toBe(false);
  });
  test('172.32.0.0（範圍外一格）判定為公開', () => {
    expect(isPrivateOrReservedIp('172.32.0.0')).toBe(false);
  });
  test('172.16.0.0（範圍第一個位址）判定為私有', () => {
    expect(isPrivateOrReservedIp('172.16.0.0')).toBe(true);
  });
  test('172.31.255.255（範圍最後一個位址）判定為私有', () => {
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
  });

  test('::1（IPv6 loopback）判定為私有', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
  });
  test('fc00::1（IPv6 unique local）判定為私有', () => {
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
  });
  test('fe80::1（IPv6 link-local）判定為私有', () => {
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
  });
  test('::ffff:127.0.0.1（IPv4-mapped IPv6 loopback）判定為私有', () => {
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
  });
  test('::ffff:8.8.8.8（IPv4-mapped IPv6 公開位址）判定為公開', () => {
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
  });
  test('2001:4860:4860::8888（公開 IPv6）判定為公開', () => {
    expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
  });

  test('無法辨識的格式一律視為不安全', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });
});

describe('assertSafePublicUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('拒絕非 http/https 協定', async () => {
    const result = await assertSafePublicUrl('ftp://example.com/file.jpg');
    expect(result.ok).toBe(false);
  });

  it('拒絕 file:// 協定', async () => {
    const result = await assertSafePublicUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('拒絕格式錯誤的網址', async () => {
    const result = await assertSafePublicUrl('not a url');
    expect(result.ok).toBe(false);
  });

  it('hostname 本身是私網 IP 字面值時拒絕，不查 DNS', async () => {
    const result = await assertSafePublicUrl('http://169.254.169.254/latest/meta-data');
    expect(result.ok).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('hostname 本身是公開 IP 字面值時允許', async () => {
    const result = await assertSafePublicUrl('http://8.8.8.8/image.jpg');
    expect(result.ok).toBe(true);
  });

  it('網域名稱解析後是私網 IP 時拒絕', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const result = await assertSafePublicUrl('https://internal.example.com/image.jpg');
    expect(result.ok).toBe(false);
  });

  it('網域名稱解析出多筆位址，其中一筆是私網 IP 時拒絕', async () => {
    mockLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const result = await assertSafePublicUrl('https://mixed.example.com/image.jpg');
    expect(result.ok).toBe(false);
  });

  it('網域名稱解析後全部是公開 IP 時允許', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const result = await assertSafePublicUrl('https://cdn.example.com/image.jpg');
    expect(result.ok).toBe(true);
  });

  it('DNS 解析失敗時拒絕', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await assertSafePublicUrl('https://nonexistent.example.invalid/image.jpg');
    expect(result.ok).toBe(false);
  });
});

describe('fetchWithSsrfGuard', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('目標網址本身是私網 IP 時，直接拒絕，不發出任何 fetch', async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchWithSsrfGuard('http://127.0.0.1/image.jpg');

    expect(result).toMatchObject({ ok: false, reason: 'blocked_host' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('正常公開網址取得 200 回應時成功', async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response('image-bytes', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchWithSsrfGuard('https://8.8.8.8/image.jpg');

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('redirect 跳轉到私網位址時，第二跳被擋下', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/secret' } })
      );
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchWithSsrfGuard('https://8.8.8.8/redirect-me');

    expect(result).toMatchObject({ ok: false, reason: 'blocked_host' });
    // 只呼叫了第一跳，第二跳在連線前就被 assertSafePublicUrl 擋下
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('redirect 跳轉到另一個公開網址時，會追蹤到最終回應', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/final.jpg' } })
      )
      .mockResolvedValueOnce(new Response('final-image-bytes', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchWithSsrfGuard('https://8.8.8.8/redirect-me');

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('redirect 次數過多時放棄並回傳失敗', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://8.8.8.8/loop' } })
      );
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchWithSsrfGuard('https://8.8.8.8/loop');

    expect(result).toMatchObject({ ok: false, reason: 'fetch_failed' });
  });

  it('網路層 fetch 失敗時回傳 fetch_failed', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await fetchWithSsrfGuard('https://8.8.8.8/image.jpg');

    expect(result).toMatchObject({ ok: false, reason: 'fetch_failed' });
  });
});
