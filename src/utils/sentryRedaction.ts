// Sentry beforeSend/beforeSendTransaction 共用的座標遮蔽邏輯，見 src/instrument.ts。
// 遮蔽對象與 Cloud Run request log（src/app.ts 的 morgan url token）共用同一套
// key 判定，見 src/utils/privacyRedaction.ts。
import type { Event } from '@sentry/node';
import {
  extractQueryFromUrl,
  redactCoordsFromQueryPairs,
  redactCoordsFromQueryRecord,
  redactCoordsFromQueryString,
  redactCoordsFromUrl,
} from './privacyRedaction';

function redactRequestEventData(request: Event['request']): void {
  if (!request) return;

  if (typeof request.url === 'string') {
    request.url = redactCoordsFromUrl(request.url);

    // request.query_string 不再獨立處理：它可能來自上游容錯 parser 對畸形
    // percent-encoding 的解析結果（例如 `la%74%=25.033` 被解析成
    // `{'lat%': '25.033'}`），這種已經 decode 過一半、不含原始 raw string 的資料
    // 無法安全地重新驗證是否為座標 key，獨立判斷有漏判風險。既然 request.url 已經
    // 遮蔽過，直接以遮蔽後的 url 重新切出 query 部分覆蓋 query_string——統一輸出成
    // string 形狀，不嘗試還原原本的 record/array 形狀（還原形狀需要重新 decode
    // 已經被容錯 parser 處理過的 key/value，同樣沒有 raw string 可驗證）。
    // 遮蔽後的 url 沒有 query（含 fail-closed 捨棄整段 query 的情況）時，
    // query_string 一併清空為空字串，不殘留任何原始內容。
    //
    // 只在原本就帶 query_string 欄位時才覆寫——欄位本來就不存在時不無端生出來，
    // 避免動到跟座標完全無關、原本就乾淨的 event 的欄位形狀。
    if ('query_string' in request) {
      request.query_string = extractQueryFromUrl(request.url);
    }
    return;
  }

  // request.url 不存在時，query_string 是唯一資訊來源，只能就地保守處理。
  // Sentry 的 RequestEventData.query_string 可能是三種形狀之一：
  // string（原始 query string）、Record<string,string>（已 parse 成物件）、
  // Array<[string,string]>（保留重複 key 的陣列形式）。欄位不存在時原樣跳過。
  const { query_string } = request;
  if (typeof query_string === 'string') {
    request.query_string = redactCoordsFromQueryString(query_string);
  } else if (Array.isArray(query_string)) {
    request.query_string = redactCoordsFromQueryPairs(query_string);
  } else if (query_string && typeof query_string === 'object') {
    request.query_string = redactCoordsFromQueryRecord(query_string as Record<string, string>);
  }
}

// span/trace data 裡可能帶座標的欄位名稱：
// - url.full／http.url／http.target：完整 URL 或 path+query，用 redactCoordsFromUrl
// - url.query／http.query：純 query string，用 redactCoordsFromQueryString
// 已對照已安裝的 @sentry/node v10（10.63.0）查證：
// - node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerSpansIntegration.js
//   對 incoming request span 設定 "http.url"（完整 URL）與 "http.target"（path+query）
// - node_modules/@sentry/node-core/build/cjs/utils/outgoingFetchRequest.js
//   對 outgoing fetch 設定 "http.query"（含開頭 ?）
// url.full／url.query 為官方 OpenTelemetry 語意慣例保留（不同版本/instrumentation
// 可能改用這組新名稱）。欄位不存在時原樣跳過，不報錯。
const URL_LIKE_DATA_KEYS = ['url.full', 'http.url', 'http.target'] as const;
const QUERY_STRING_DATA_KEYS = ['url.query', 'http.query'] as const;

function redactUrlLikeDataFields(data: Record<string, unknown> | undefined): void {
  if (!data) return;

  for (const key of URL_LIKE_DATA_KEYS) {
    const value = data[key];
    if (typeof value === 'string') {
      data[key] = redactCoordsFromUrl(value);
    }
  }

  for (const key of QUERY_STRING_DATA_KEYS) {
    const value = data[key];
    if (typeof value === 'string') {
      data[key] = redactCoordsFromQueryString(value);
    }
  }
}

// Bounded quantifiers keep matching linear (an unbounded pattern was quadratic on long
// '@'-free strings), and excluding '/' keeps URL paths around an email intact.
const EMAIL_PATTERN = /[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;

function redactEmails(text: string): string {
  return text.includes('@') ? text.replace(EMAIL_PATTERN, '[email]') : text;
}

// Request bodies (email, messages, submissions) are personal data; keep only their shape
// (field names, types, lengths) so input-dependent bugs stay debuggable without storing values.
const MAX_SHAPE_DEPTH = 2;

function shapeOf(value: unknown, depth: number): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'string') return `string(${value.length})`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= MAX_SHAPE_DEPTH) return `object(${entries.length})`;
    return Object.fromEntries(
      entries.map(([key, child]) => [redactEmails(key), shapeOf(child, depth + 1)])
    );
  }
  return typeof value;
}

function redactRequestBody(request: NonNullable<Event['request']>): void {
  const { data } = request;
  if (data === undefined) return;
  if (typeof data === 'string') {
    try {
      request.data = shapeOf(JSON.parse(data), 0);
    } catch {
      request.data = `[Filtered] string(${data.length})`;
    }
    return;
  }
  request.data = shapeOf(data, 0);
}

// Same idea as the SDK's own span-header filter: any header named like a credential or session.
const SENSITIVE_HEADER_SNIPPETS = [
  'auth',
  'token',
  'session',
  'cookie',
  'key',
  'secret',
  'password',
  'csrf',
  'jwt',
];

function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADER_SNIPPETS.some(snippet => lower.includes(snippet));
}

function redactCredentials(request: NonNullable<Event['request']>): void {
  delete request.cookies;
  if (!request.headers) return;
  for (const key of Object.keys(request.headers)) {
    if (isSensitiveHeaderName(key)) request.headers[key] = '[Filtered]';
  }
}

function redactEmailsDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactEmails(value);
  if (depth >= 3 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactEmailsDeep(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      redactEmailsDeep(v, depth + 1),
    ])
  );
}

// Console breadcrumbs carry whatever was logged, e.g. emailService logging recipients.
function redactBreadcrumbs(breadcrumbs: Event['breadcrumbs']): void {
  breadcrumbs?.forEach(crumb => {
    if (typeof crumb.message === 'string') crumb.message = redactEmails(crumb.message);
    if (crumb.data) crumb.data = redactEmailsDeep(crumb.data) as typeof crumb.data;
  });
}

// The server span records the caller's IP even with sendDefaultPii off, and copies request
// and response headers (including individual cookies) into http.*.header.* attributes.
const CLIENT_IP_DATA_KEYS = ['http.client_ip', 'client.address'] as const;
const HEADER_ATTRIBUTE_PREFIX = /^http\.(?:request|response)\.header\./;

function redactSpanData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of CLIENT_IP_DATA_KEYS) {
    if (key in data) data[key] = '[Filtered]';
  }
  for (const key of Object.keys(data)) {
    const header = key.replace(HEADER_ATTRIBUTE_PREFIX, '');
    if (header !== key && isSensitiveHeaderName(header)) data[key] = '[Filtered]';
  }
}

/**
 * Shared by Sentry beforeSend/beforeSendTransaction: redacts coordinates, request bodies,
 * credential headers, emails in breadcrumbs, and client IPs and header copies on spans, in place.
 * Always returns the event (never null) so errors and transactions are still reported.
 */
export function redactSentryEvent<T extends Event>(event: T): T {
  redactRequestEventData(event.request);
  if (event.request) {
    redactRequestBody(event.request);
    redactCredentials(event.request);
  }
  redactBreadcrumbs(event.breadcrumbs);
  const traceData = event.contexts?.trace?.data as Record<string, unknown> | undefined;
  redactUrlLikeDataFields(traceData);
  redactSpanData(traceData);
  event.spans?.forEach(span => {
    const spanData = span.data as Record<string, unknown> | undefined;
    redactUrlLikeDataFields(spanData);
    redactSpanData(spanData);
  });
  return event;
}
