import dns from 'dns';
import net from 'net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * SSRF 防護：`fetch-image` endpoint 讓已登入的 admin 帳號觸發伺服器對任意網址發出 request，
 * 即使只開放給 admin，仍防止帳號外流或誤用時拿伺服器去探測內網（尤其雲端環境常見的 metadata endpoint）。
 * 見 specs/features/event-import-assistant/design-backend.md 〈SSRF 防護〉。
 */

const BLOCKED_IPV4_CIDRS: Array<{ base: string; prefix: number }> = [
  { base: '10.0.0.0', prefix: 8 }, // 私有網段
  { base: '172.16.0.0', prefix: 12 }, // 私有網段
  { base: '192.168.0.0', prefix: 16 }, // 私有網段
  { base: '127.0.0.0', prefix: 8 }, // loopback
  { base: '169.254.0.0', prefix: 16 }, // link-local，含雲端 metadata endpoint 169.254.169.254
  { base: '0.0.0.0', prefix: 8 }, // "this network" / unspecified
];

function ipv4ToLong(ip: string): number {
  return (
    ip
      .split('.')
      .map(Number)
      .reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0
  );
}

function isIpv4InCidr(ip: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(base) & mask);
}

function isPrivateIpv4(ip: string): boolean {
  return BLOCKED_IPV4_CIDRS.some(({ base, prefix }) => isIpv4InCidr(ip, base, prefix));
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === '::1' || normalized === '::') {
    return true; // loopback / unspecified
  }

  // fc00::/7：第一個 byte 是 0xfc 或 0xfd
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  // fe80::/10：link-local。範圍是第一個 16-bit 群組落在 0xfe80~0xfebf
  // （即 fe80 ~ febf 開頭都算，例如 fea0::1、feb2::1 也是 link-local）。
  // 舊版只用字串前綴比對 'fe8'／'fe9'，漏掉 'fea*'／'feb*'，等於這段範圍完全沒被攔到。
  // 改成把第一個 hextet 解析成數值後判斷區間，不受省略前導零的表示法影響。
  const firstHextet = parseInt(normalized.split(':')[0] || '', 16);
  if (!Number.isNaN(firstHextet) && firstHextet >= 0xfe80 && firstHextet <= 0xfebf) {
    return true;
  }

  // IPv4-mapped IPv6（RFC 4291 ::ffff:0:0/96）：內層 IPv4 位址可能寫成
  // dotted-quad（例如 ::ffff:127.0.0.1）或壓縮後的 hex 形式（例如 ::ffff:7f00:1，
  // 等於 127.0.0.1；::ffff:a9fe:a9fe 等於雲端 metadata endpoint 169.254.169.254）。
  // 舊版只比對 dotted-quad 前綴，hex 形式會被誤判成一般公開位址、完全繞過 SSRF 檢查。
  // 前綴同時涵蓋 `::ffff:`（前導零群組被壓縮）與完整展開的 `0:0:0:0:0:ffff:` 兩種寫法，
  // 拆出內層 IPv4 位址後套用既有的 isPrivateIpv4 判斷。
  const v4MappedPrefix = '(?:::ffff:|(?:0{1,4}:){5}ffff:)';
  const v4MappedDotted = normalized.match(
    new RegExp(`^${v4MappedPrefix}(\\d+\\.\\d+\\.\\d+\\.\\d+)$`)
  );
  if (v4MappedDotted) {
    return isPrivateIpv4(v4MappedDotted[1]);
  }

  const v4MappedHex = normalized.match(
    new RegExp(`^${v4MappedPrefix}([0-9a-f]{1,4}):([0-9a-f]{1,4})$`)
  );
  if (v4MappedHex) {
    const high = parseInt(v4MappedHex[1], 16);
    const low = parseInt(v4MappedHex[2], 16);
    const ipv4 = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.');
    return isPrivateIpv4(ipv4);
  }

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // 無法辨識的格式一律視為不安全
}

// 通過安全檢查後，實際應該拿去連線的 IP。用來把 assertSafePublicUrl 檢查當下驗證過的
// IP「釘」在後續真正的連線上，見下方 fetchWithTimeout 對 DNS rebinding TOCTOU 的說明。
export interface PinnedAddress {
  ip: string;
  family: 4 | 6;
}

export interface SafeUrlCheckResult {
  ok: boolean;
  error?: string;
  pinnedAddress?: PinnedAddress;
}

/**
 * 檢查單一網址是否可安全存取：protocol 白名單 + hostname/DNS 解析後的 IP 不落在私有/保留範圍。
 * 只檢查「這個網址本身」，不處理 redirect（redirect 由 fetchWithSsrfGuard 逐跳呼叫本函式）。
 *
 * 回傳的 pinnedAddress 是這次檢查當下驗證過的其中一個安全 IP，呼叫端應該讓實際發送的
 * request 直接連到這個 IP（而不是讓 fetch 自己對 hostname 重新做一次 DNS 解析），
 * 否則會有 DNS rebinding TOCTOU 風險：檢查當下解析出安全 IP，但實際連線時 DNS
 * 已經改指向內網位址。
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<SafeUrlCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: '圖片網址格式不正確' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '不支援的網址協定' };
  }

  const hostname = url.hostname;

  // hostname 本身就是 IP 字面值：沒有 DNS 解析這一步，不存在 rebinding 問題，
  // 直接把這個 IP 當作 pinnedAddress。
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { ok: false, error: '不允許存取內部網路位址' };
    }
    return { ok: true, pinnedAddress: { ip: hostname, family: net.isIP(hostname) as 4 | 6 } };
  }

  // hostname 是網域名稱，DNS 解析後逐一檢查每個回傳的 IP
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (addresses.length === 0) {
      return { ok: false, error: '無法解析網址主機' };
    }
    if (addresses.some(addr => isPrivateOrReservedIp(addr.address))) {
      return { ok: false, error: '不允許存取內部網路位址' };
    }
    // 挑其中一筆（第一筆）已驗證過的位址釘住，後續連線不再重新查 DNS
    const [{ address, family }] = addresses;
    return { ok: true, pinnedAddress: { ip: address, family: family as 4 | 6 } };
  } catch {
    return { ok: false, error: '無法解析網址主機' };
  }
}

const MAX_REDIRECTS = 5;

export type GuardedFetchFailureReason = 'blocked_host' | 'fetch_failed';

// 刻意用扁平、欄位皆為 optional 的 interface，不用 discriminated union：
// 這個專案的 tsconfig 是 `strict: false`（未開 strictNullChecks），
// 在這個設定下 `if (!result.ok)` 無法正確 narrow 出 union 的另一個分支
// （已用最小重現案例驗證），比照專案既有 `UploadResult`/`DeleteResult` 的寫法，
// 呼叫端改用 `result.ok`／`result.response` 的存在與否判斷，不依賴 union narrowing。
export interface GuardedFetchResult {
  ok: boolean;
  response?: globalThis.Response;
  reason?: GuardedFetchFailureReason;
  error?: string;
}

// Node net 模組 lookup option 的 callback 簽名（型別未對外匯出，這裡照文件手刻一份）。
// Node 20+ 的 net/tls connect 預設走 Happy Eyeballs（dual-stack 並行嘗試），會用
// `{ all: true }` 呼叫 lookup、並期待 callback 收到「位址陣列」而不是單一位址字串；
// 沒有 all 時才是單一位址的舊式簽名。兩種呼叫方式都要支援，只實作其中一種在 Node 20+
// 下會直接連線失敗（已用下方 fetchWithSsrfGuard 的整合測試實測驗證過這個分歧）。
type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number
) => void;
type NodeLookupOptions = { all?: boolean };

/**
 * 建立一個「不查 DNS、直接回傳已釘住的 IP」的 lookup function，塞進 undici Agent 的
 * `connect.lookup`。Node 的 net/tls connect 預設會用 dns.lookup(hostname, ...) 自己重新
 * 解析一次 hostname 才建立 TCP 連線；用這個 lookup 頂替掉那次解析，讓實際連線走的是
 * assertSafePublicUrl 檢查當下就已經驗證過安全的那個 IP，而不是連線當下才臨時查到、
 * 可能已經被攻擊者透過 DNS rebinding 改指向內網的位址。
 */
function createPinnedLookup(pinnedAddress: PinnedAddress) {
  return (_hostname: string, options: NodeLookupOptions, callback: NodeLookupCallback): void => {
    if (options?.all) {
      callback(null, [{ address: pinnedAddress.ip, family: pinnedAddress.family }]);
    } else {
      callback(null, pinnedAddress.ip, pinnedAddress.family);
    }
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  pinnedAddress: PinnedAddress
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // dispatcher 只服務這一次連線：連線目標被釘死在 pinnedAddress，不會被其他呼叫共用，
  // 也就不需要處理跨請求的連線池重用問題。不手動呼叫 agent.close()：呼叫端可能還在
  // 串流讀取 response body，這裡就把連線關掉會中斷讀取；交給 undici 預設的
  // keepAliveTimeout（4 秒無活動）在使用完後自動回收即可。
  const agent = new Agent({
    connect: {
      lookup: createPinnedLookup(pinnedAddress),
      // TLS 憑證／SNI 仍然驗證原始 hostname（來自 url 本身，不受這裡影響），
      // 只有「連去哪個 IP」被釘住，不影響憑證主機名稱驗證的正確性。
    } as ConstructorParameters<typeof Agent>[0]['connect'],
  });

  try {
    // 刻意用 `undici` 套件自己的 fetch，不用 Node 全域的 fetch：Node 全域 fetch 底下綁的是
    // Node 自己內建、版本固定的 undici，若把外部安裝的 `undici` 套件生成的 Agent
    // 塞進全域 fetch 的 dispatcher，兩邊 undici 版本的 dispatch handler 協定對不上，
    // 會直接丟出 `InvalidArgumentError: invalid onRequestStart method`（已實測重現）。
    // Agent 跟 fetch 必須來自同一個 undici 版本才相容。
    // undici 套件自帶的 Response 型別跟 @types/node 全域 Response 型別在極少數 iterator
    // 相關型別細節上對不齊（實際上都是標準 WHATWG Response，執行期行為一致），
    // 這裡用型別轉換橋接，呼叫端一律用回傳值上既有的 headers/status/arrayBuffer 等
    // 標準 Fetch API 存取，不受影響。
    const response = await undiciFetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]);
    return response as unknown as globalThis.Response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 帶 SSRF 防護的 fetch：每一跳（含 redirect 目標）都先過 `assertSafePublicUrl` 才連線，
 * 避免一個看似正常的網址跳轉到內網。手動處理 redirect（不用 fetch 的 `redirect: 'follow'`），
 * 因為 follow 模式底層會自動連線到 redirect 目標，來不及在連線前檢查。
 */
export async function fetchWithSsrfGuard(
  startUrl: string,
  options: { timeoutMs?: number } = {}
): Promise<GuardedFetchResult> {
  const { timeoutMs = 8000 } = options;
  let currentUrl = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const guard = await assertSafePublicUrl(currentUrl);
    if (!guard.ok || !guard.pinnedAddress) {
      return { ok: false, reason: 'blocked_host', error: guard.error ?? '不允許存取的網址' };
    }

    let response: globalThis.Response;
    try {
      response = await fetchWithTimeout(
        currentUrl,
        { redirect: 'manual' },
        timeoutMs,
        guard.pinnedAddress
      );
    } catch {
      return { ok: false, reason: 'fetch_failed', error: '來源圖片無法取得，網址可能已失效' };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { ok: false, reason: 'fetch_failed', error: '來源圖片無法取得，網址可能已失效' };
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, reason: 'fetch_failed', error: '來源圖片無法取得，網址可能已失效' };
      }
      continue;
    }

    return { ok: true, response };
  }

  return { ok: false, reason: 'fetch_failed', error: '重新導向次數過多' };
}
