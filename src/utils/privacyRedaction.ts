// 座標類 query 參數（目前為場地距離最近排序 sort=distance 的 lat/lng）不應寫進任何
// 第三方/平台記錄（Cloud Run request log、Sentry event）——即使前端已把座標四捨五入
// 到小數第 3 位（約 100 公尺精度），仍是可追蹤到大致位置的個資。
//
// 共用於：
// - src/app.ts：覆寫 morgan 的 `:url` token（Cloud Run request log）
// - src/utils/sentryRedaction.ts：Sentry beforeSend/beforeSendTransaction
//
// 之後若新增其他座標/個資類 query 參數，只需要在 COORD_QUERY_KEYS 補上 key。

const COORD_QUERY_KEYS = new Set(['lat', 'lng']);

// 大小寫、percent-encoding 皆需視為同一個 key（例如 ?LAT=25、?%4Cat=25 都要遮蔽）。
const isCoordKey = (key: string): boolean => COORD_QUERY_KEYS.has(key.toLowerCase());

/**
 * 自行切 raw query string（不透過 URLSearchParams），逐個 key 嚴格 decode 後比對。
 *
 * 背景：URLSearchParams 對畸形 percent-encoding（如 `la%74%=`、`lat%=`）有容錯，
 * 不會拋例外，導致這類 key 無法被正確 decode 比對、也就不會被判定成 lat/lng，
 * 座標因而原封不動流出去。改成自己 split + decodeURIComponent，任何一個 key
 * decode 失敗就视為整段 query 不可信，fail closed 捨棄整段（由呼叫端處理）。
 *
 * 非座標參數的 value 維持原始 encoding 不變（不重新編碼），只有座標 key 對應的
 * value 會被換成 REDACTED；key 本身（含原始 percent-encoding 形式）不更動。
 *
 * @returns 重組後的 query string（不含開頭 `?`），或 null 代表某個 key 解碼失敗
 *          （呼叫端應 fail closed，捨棄整段 query）。
 */
const redactRawQuery = (rawQuery: string): string | null => {
  if (rawQuery === '') return '';

  const segments = rawQuery.split('&');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '') {
      result.push(segment);
      continue;
    }

    const eqIndex = segment.indexOf('=');
    const rawKey = eqIndex === -1 ? segment : segment.slice(0, eqIndex);

    let decodedKey: string;
    try {
      decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      return null;
    }

    if (isCoordKey(decodedKey)) {
      result.push(`${rawKey}=REDACTED`);
    } else {
      result.push(segment);
    }
  }

  return result.join('&');
};

// 給相對路徑（如 morgan 的 req.originalUrl，永遠不含 scheme/host）用的佔位 base，
// 只是讓 new URL() 能夠解析——不代表任何真實網域。
const RELATIVE_URL_BASE = 'http://internal';

/**
 * 遮蔽完整 URL（含 scheme/host，如 Sentry 的 http.url/url.full）或純 path+query
 * （如 morgan 的 req.originalUrl）字串中的座標 query 參數，其餘參數維持原樣。
 *
 * 輸入本身是絕對 URL 時保留原 origin；輸入是相對路徑時輸出也只有 path+query
 * （不無端補上佔位 origin），行為與既有 morgan log 遮蔽一致。
 *
 * 解析失敗時 fail closed：整段 query string 直接捨棄（只保留 path），而不是
 * 回傳原始字串——寧可多丟一點診斷用的查詢參數，也不能讓無法正確遮蔽的座標
 * 原封不動流出去。
 */
export function redactCoordsFromUrl(urlOrPath: string): string {
  try {
    const url = new URL(urlOrPath, RELATIVE_URL_BASE);
    const isRelativeInput = url.origin === RELATIVE_URL_BASE;
    const base = (isRelativeInput ? '' : url.origin) + url.pathname;
    if (!url.search) return base;

    const redactedQuery = redactRawQuery(url.search.slice(1));
    // redactedQuery === null：某個 key decode 失敗，fail closed 捨棄整段 query。
    return redactedQuery === null ? base : `${base}?${redactedQuery}`;
  } catch {
    return urlOrPath.split('?')[0];
  }
}

/**
 * 遮蔽單純 query string（可能帶或不帶開頭的 `?`），用於 Sentry span/trace data
 * 裡只存 query 部分、不含 path 的欄位（如 `url.query`、`http.query`）。
 * 解析失敗時 fail closed：回傳空字串，而不是原始字串。
 */
export function redactCoordsFromQueryString(queryString: string): string {
  const hasLeadingMark = queryString.startsWith('?');
  const raw = hasLeadingMark ? queryString.slice(1) : queryString;
  const redacted = redactRawQuery(raw);
  // redacted === null：某個 key decode 失敗，fail closed 回傳空字串。
  if (redacted === null || redacted === '') return '';
  return hasLeadingMark ? `?${redacted}` : redacted;
}

/**
 * 從一個「已知安全」的 URL/path 字串（必須是 redactCoordsFromUrl 的回傳值，
 * 不是任意外部輸入）取出 query 部分（含開頭 `?`；沒有 query 則回傳空字串）。
 *
 * 用於 sentryRedaction.ts：request.url 遮蔽後，request.query_string 一律從
 * 遮蔽後的 url 重新切出，而不是獨立處理 query_string 原本的值——因為
 * query_string 可能來自上游容錯 parser 對畸形 percent-encoding 的解析結果
 * （例如 `la%74%=25.033` 被解析成 `{'lat%': '25.033'}`），這種已經 decode 過
 * 一半的資料沒有 raw string 可以重新驗證，無法保證獨立判斷時不會漏判。
 *
 * 因為輸入保證是 redactCoordsFromUrl 的輸出（本身就是由合法 URL 的
 * pathname/origin 組成，不含未解析的畸形 percent-encoding），這裡不需要
 * 再做一次 fail-closed 判斷；try/catch 只是防禦性寫法。
 */
export function extractQueryFromUrl(url: string): string {
  try {
    return new URL(url, RELATIVE_URL_BASE).search;
  } catch {
    return '';
  }
}

// Record/pairs 形狀的 query_string 沒有 raw string 可以重新 decode 驗證（上游容錯
// parser 已經處理過一次，例如把畸形 percent-encoding `la%74%` decode 到一半變成
// `lat%`）。只能保守比對：key 轉小寫後以 `lat`/`lng` 開頭（不要求完全相等）就視為
// 座標 key 一併遮蔽，寧可多遮蔽幾個巧合同字首的無關參數，也不能讓座標漏出。
const isSuspiciousCoordKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return lower.startsWith('lat') || lower.startsWith('lng');
};

/**
 * 遮蔽物件形狀的 query_string（Sentry RequestEventData.query_string 的其中一種型態）。
 * 只在 request.url 不存在、沒有其他資訊來源可用時才會走到這裡（見 sentryRedaction.ts）。
 */
export function redactCoordsFromQueryRecord(
  record: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = isSuspiciousCoordKey(key) ? 'REDACTED' : value;
  }
  return result;
}

/**
 * 遮蔽 [key, value][] 陣列形狀的 query_string（Sentry RequestEventData.query_string 的另一種型態）。
 * 只在 request.url 不存在、沒有其他資訊來源可用時才會走到這裡（見 sentryRedaction.ts）。
 */
export function redactCoordsFromQueryPairs(
  pairs: Array<[string, string]>
): Array<[string, string]> {
  return pairs.map(([key, value]): [string, string] => [
    key,
    isSuspiciousCoordKey(key) ? 'REDACTED' : value,
  ]);
}
