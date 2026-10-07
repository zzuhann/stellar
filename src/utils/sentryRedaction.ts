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

/**
 * Sentry beforeSend/beforeSendTransaction 共用：遮蔽 event 裡任何可能帶座標的欄位，
 * mutate in place 後回傳同一個 event（永遠不回傳 null）——錯誤或效能事件仍要回報，
 * 只是拿掉座標，不是整筆事件都丟掉。
 */
export function redactSentryEvent<T extends Event>(event: T): T {
  redactRequestEventData(event.request);
  redactUrlLikeDataFields(event.contexts?.trace?.data as Record<string, unknown> | undefined);
  event.spans?.forEach(span =>
    redactUrlLikeDataFields(span.data as Record<string, unknown> | undefined)
  );
  return event;
}
