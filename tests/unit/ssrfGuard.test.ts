jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

// 只 mock `fetch`（實際發連線的那一步），`Agent` 保留真正的 undici 實作並用 jest.fn()
// 包一層記錄建構參數：這樣才能在測試裡真的呼叫 connect.lookup 這個 function，
// 驗證它有沒有正確把「已驗證過的 IP」釘住（DNS rebinding TOCTOU 防護的核心行為），
// 而不是只驗證 fetch 有沒有被呼叫。
jest.mock('undici', () => {
  const actual = jest.requireActual('undici');
  return {
    ...actual,
    Agent: jest.fn().mockImplementation((opts: unknown) => new actual.Agent(opts)),
    fetch: jest.fn(),
  };
});

import dns from 'dns';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  assertSafePublicUrl,
  fetchWithSsrfGuard,
  isPrivateOrReservedIp,
} from '../../src/utils/ssrfGuard';

const mockLookup = dns.promises.lookup as jest.Mock;
const mockAgent = Agent as unknown as jest.Mock;
const mockUndiciFetch = undiciFetch as unknown as jest.Mock;

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

  // fe80::/10 涵蓋 fe80 ~ febf 開頭，範圍邊界要逐一驗證：
  // 舊版只用字串前綴比對 'fe8'/'fe9'，fea*／feb* 完全沒被攔到，是這次修正的重點。
  test('fea0::1（fe80::/10 範圍內，前綴 fea）判定為私有', () => {
    expect(isPrivateOrReservedIp('fea0::1')).toBe(true);
  });
  test('feb0::1（fe80::/10 範圍內，前綴 feb）判定為私有', () => {
    expect(isPrivateOrReservedIp('feb0::1')).toBe(true);
  });
  test('febf::ffff（fe80::/10 範圍最後一個位址）判定為私有', () => {
    expect(isPrivateOrReservedIp('febf::ffff')).toBe(true);
  });
  test('fe80::（fe80::/10 範圍第一個位址）判定為私有', () => {
    expect(isPrivateOrReservedIp('fe80::')).toBe(true);
  });
  test('fe7f::1（範圍外一格，低於 fe80）判定為公開', () => {
    expect(isPrivateOrReservedIp('fe7f::1')).toBe(false);
  });
  test('fec0::1（範圍外一格，高於 febf）判定為公開', () => {
    expect(isPrivateOrReservedIp('fec0::1')).toBe(false);
  });
  test('::ffff:127.0.0.1（IPv4-mapped IPv6 loopback，dotted-quad 形式）判定為私有', () => {
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
  });
  test('::ffff:8.8.8.8（IPv4-mapped IPv6 公開位址，dotted-quad 形式）判定為公開', () => {
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
  });

  // IPv4-mapped IPv6 的 hex 壓縮形式：::ffff:XXXX:YYYY（XXXX/YYYY 各是 16 bit hex，
  // 合起來就是內層 32 bit 的 IPv4 位址）。舊版只認 dotted-quad 前綴字串比對，
  // 這種 hex 表示法會被誤判成一般公開 IPv6、完全繞過 SSRF 檢查。
  test('::ffff:7f00:1（IPv4-mapped IPv6 loopback，hex 壓縮形式，等於 127.0.0.1）判定為私有', () => {
    expect(isPrivateOrReservedIp('::ffff:7f00:1')).toBe(true);
  });
  test('::ffff:a9fe:a9fe（IPv4-mapped IPv6，hex 壓縮形式，等於雲端 metadata endpoint 169.254.169.254）判定為私有', () => {
    expect(isPrivateOrReservedIp('::ffff:a9fe:a9fe')).toBe(true);
  });
  test('::ffff:808:808（IPv4-mapped IPv6，hex 壓縮形式，等於公開位址 8.8.8.8）判定為公開', () => {
    expect(isPrivateOrReservedIp('::ffff:808:808')).toBe(false);
  });
  // 完整展開（未用 :: 壓縮前導零群組）的 hex 形式也要涵蓋
  test('0:0:0:0:0:ffff:7f00:1（IPv4-mapped IPv6 loopback，完整展開 hex 形式）判定為私有', () => {
    expect(isPrivateOrReservedIp('0:0:0:0:0:ffff:7f00:1')).toBe(true);
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('目標網址本身是私網 IP 時，直接拒絕，不發出任何 fetch', async () => {
    const result = await fetchWithSsrfGuard('http://127.0.0.1/image.jpg');

    expect(result).toMatchObject({ ok: false, reason: 'blocked_host' });
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });

  it('正常公開網址取得 200 回應時成功', async () => {
    mockUndiciFetch.mockResolvedValue(new Response('image-bytes', { status: 200 }));

    const result = await fetchWithSsrfGuard('https://8.8.8.8/image.jpg');

    expect(result.ok).toBe(true);
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('redirect 跳轉到私網位址時，第二跳被擋下', async () => {
    mockUndiciFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/secret' } })
    );

    const result = await fetchWithSsrfGuard('https://8.8.8.8/redirect-me');

    expect(result).toMatchObject({ ok: false, reason: 'blocked_host' });
    // 只呼叫了第一跳，第二跳在連線前就被 assertSafePublicUrl 擋下
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
  });

  it('redirect 跳轉到另一個公開網址時，會追蹤到最終回應', async () => {
    mockUndiciFetch
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/final.jpg' } })
      )
      .mockResolvedValueOnce(new Response('final-image-bytes', { status: 200 }));

    const result = await fetchWithSsrfGuard('https://8.8.8.8/redirect-me');

    expect(result.ok).toBe(true);
    expect(mockUndiciFetch).toHaveBeenCalledTimes(2);
  });

  it('redirect 次數過多時放棄並回傳失敗', async () => {
    mockUndiciFetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://8.8.8.8/loop' } })
    );

    const result = await fetchWithSsrfGuard('https://8.8.8.8/loop');

    expect(result).toMatchObject({ ok: false, reason: 'fetch_failed' });
  });

  it('網路層 fetch 失敗時回傳 fetch_failed', async () => {
    mockUndiciFetch.mockRejectedValue(new TypeError('fetch failed'));

    const result = await fetchWithSsrfGuard('https://8.8.8.8/image.jpg');

    expect(result).toMatchObject({ ok: false, reason: 'fetch_failed' });
  });

  // DNS rebinding TOCTOU 防護：assertSafePublicUrl 檢查當下解析出的 IP，跟實際連線時
  // 使用的 IP 必須是同一個，不能讓 fetch 自己對 hostname 重新查一次 DNS
  // （見 src/utils/ssrfGuard.ts fetchWithTimeout 的說明）。
  describe('DNS rebinding 防護：連線用的是檢查當下驗證過的 IP，不是連線當下重查的 DNS', () => {
    it('傳給 undici Agent 的 connect.lookup 回傳的是檢查當下解析出的 IP，不論之後 DNS 換了什麼', async () => {
      // 檢查當下（assertSafePublicUrl）DNS 解析出安全的公開 IP
      mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
      mockUndiciFetch.mockResolvedValue(new Response('image-bytes', { status: 200 }));

      const result = await fetchWithSsrfGuard('https://rebinding.example.com/image.jpg');
      expect(result.ok).toBe(true);

      // 取出實際傳給 undici Agent 建構子的 connect.lookup
      expect(mockAgent).toHaveBeenCalledTimes(1);
      const connectOptions = mockAgent.mock.calls[0][0].connect;
      const pinnedLookup = connectOptions.lookup;

      // 模擬「攻擊者這時候把 DNS 改指向內網」：即使有人在連線當下對這個 lookup
      // 傳入任何 hostname/options，也不應該真的去查 DNS，而是直接回傳先前已驗證過的
      // 8.8.8.8，不會變成攻擊者想 rebind 過去的內網位址（例如 169.254.169.254）。
      const singleAddressCallback = jest.fn();
      pinnedLookup('rebinding.example.com', {}, singleAddressCallback);
      expect(singleAddressCallback).toHaveBeenCalledWith(null, '8.8.8.8', 4);

      // Node 20+ Happy Eyeballs 會用 { all: true } 呼叫 lookup，這個分支也要回傳釘住的 IP
      const allAddressCallback = jest.fn();
      pinnedLookup('rebinding.example.com', { all: true }, allAddressCallback);
      expect(allAddressCallback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);

      // 檢查當下只查了一次 DNS（assertSafePublicUrl 那一次），connect.lookup 本身
      // 不會再觸發任何一次額外的 dns.promises.lookup 呼叫
      expect(mockLookup).toHaveBeenCalledTimes(1);
    });

    it('redirect 每一跳都各自釘住該跳檢查當下驗證過的 IP', async () => {
      mockLookup
        .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]) // 第一跳
        .mockResolvedValueOnce([{ address: '9.9.9.9', family: 4 }]); // redirect 後第二跳
      mockUndiciFetch
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: 'https://hop2.example.com/final.jpg' },
          })
        )
        .mockResolvedValueOnce(new Response('final-image-bytes', { status: 200 }));

      const result = await fetchWithSsrfGuard('https://hop1.example.com/redirect-me');
      expect(result.ok).toBe(true);

      expect(mockAgent).toHaveBeenCalledTimes(2);
      const firstHopLookup = mockAgent.mock.calls[0][0].connect.lookup;
      const secondHopLookup = mockAgent.mock.calls[1][0].connect.lookup;

      const cb1 = jest.fn();
      firstHopLookup('hop1.example.com', {}, cb1);
      expect(cb1).toHaveBeenCalledWith(null, '1.1.1.1', 4);

      const cb2 = jest.fn();
      secondHopLookup('hop2.example.com', {}, cb2);
      expect(cb2).toHaveBeenCalledWith(null, '9.9.9.9', 4);
    });
  });
});
