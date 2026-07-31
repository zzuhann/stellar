import dns from 'dns';
import net from 'net';

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

  // fe80::/10：link-local
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) {
    return true;
  }

  // IPv4-mapped IPv6（例如 ::ffff:127.0.0.1）：拆出內層 IPv4 再檢查一次，
  // 避免用這個形式繞過 IPv4 私網檢查
  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) {
    return isPrivateIpv4(v4Mapped[1]);
  }

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // 無法辨識的格式一律視為不安全
}

export interface SafeUrlCheckResult {
  ok: boolean;
  error?: string;
}

/**
 * 檢查單一網址是否可安全存取：protocol 白名單 + hostname/DNS 解析後的 IP 不落在私有/保留範圍。
 * 只檢查「這個網址本身」，不處理 redirect（redirect 由 fetchWithSsrfGuard 逐跳呼叫本函式）。
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

  // hostname 本身就是 IP 字面值
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { ok: false, error: '不允許存取內部網路位址' };
    }
    return { ok: true };
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
  } catch {
    return { ok: false, error: '無法解析網址主機' };
  }

  return { ok: true };
}

const MAX_REDIRECTS = 5;

export type GuardedFetchFailureReason = 'blocked_host' | 'fetch_failed';

export type GuardedFetchResult =
  | { ok: true; response: globalThis.Response }
  | { ok: false; reason: GuardedFetchFailureReason; error: string };

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
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
    if (!guard.ok) {
      return { ok: false, reason: 'blocked_host', error: guard.error ?? '不允許存取的網址' };
    }

    let response: globalThis.Response;
    try {
      response = await fetchWithTimeout(currentUrl, { redirect: 'manual' }, timeoutMs);
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
