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
// URL/URLSearchParams 的 parser 本身已經會 decode key（%4C → L），這裡只需要在比對
// 前額外轉小寫，不需要自己處理 decode。
const isCoordKey = (key: string): boolean => COORD_QUERY_KEYS.has(key.toLowerCase());

const redactParams = (params: URLSearchParams): void => {
  // 用 Array.from 先複製一份 key 列表，避免在 forEach/for-of 迭代中呼叫 set() 修改
  // 同一個 URLSearchParams 導致的迭代器狀態問題（部分環境對「迭代中修改」行為不保證）。
  Array.from(params.keys()).forEach(key => {
    if (isCoordKey(key)) params.set(key, 'REDACTED');
  });
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
    redactParams(url.searchParams);
    const query = url.search ? `?${url.searchParams.toString()}` : '';
    const isRelativeInput = url.origin === RELATIVE_URL_BASE;
    return (isRelativeInput ? '' : url.origin) + url.pathname + query;
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
  try {
    const params = new URLSearchParams(hasLeadingMark ? queryString.slice(1) : queryString);
    redactParams(params);
    const serialized = params.toString();
    if (!serialized) return '';
    return hasLeadingMark ? `?${serialized}` : serialized;
  } catch {
    return '';
  }
}

/** 遮蔽物件形狀的 query_string（Sentry RequestEventData.query_string 的其中一種型態）。 */
export function redactCoordsFromQueryRecord(
  record: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = isCoordKey(key) ? 'REDACTED' : value;
  }
  return result;
}

/** 遮蔽 [key, value][] 陣列形狀的 query_string（Sentry RequestEventData.query_string 的另一種型態）。 */
export function redactCoordsFromQueryPairs(
  pairs: Array<[string, string]>
): Array<[string, string]> {
  return pairs.map(([key, value]): [string, string] => [key, isCoordKey(key) ? 'REDACTED' : value]);
}
