import type { Event } from '@sentry/node';
import { redactSentryEvent } from '../../src/utils/sentryRedaction';

// 對應第一輪 code review 補強項目 1：Sentry beforeSend/beforeSendTransaction 的
// 座標遮蔽邏輯。測試直接針對共用的 redactSentryEvent pure function，不透過
// Sentry.init 實際發送事件（instrument.ts 只負責把它接到 beforeSend/
// beforeSendTransaction，接線本身不需要額外測試，比照 app.ts 的 morgan token
// wiring 慣例）。

const baseEvent = (overrides: Partial<Event> = {}): Event => ({
  event_id: 'evt-1',
  timestamp: 0,
  ...overrides,
});

describe('redactSentryEvent — event.request', () => {
  it('遮蔽 request.url 中的 lat/lng，其餘參數維持原樣', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues?sort=distance&lat=25.033&lng=121.564',
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.url).toContain('lat=REDACTED');
    expect(result.request?.url).toContain('lng=REDACTED');
    expect(result.request?.url).not.toContain('25.033');
    expect(result.request?.url).toContain('sort=distance');
  });

  it('query_string 為 string 形狀時正確遮蔽', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues',
        query_string: '?lat=25.033&lng=121.564',
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toBe('?lat=REDACTED&lng=REDACTED');
  });

  it('query_string 為物件形狀時正確遮蔽', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues',
        query_string: { lat: '25.033', lng: '121.564', region: '台北' },
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toEqual({
      lat: 'REDACTED',
      lng: 'REDACTED',
      region: '台北',
    });
  });

  it('query_string 為 [key,value][] 陣列形狀時正確遮蔽', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues',
        query_string: [
          ['lat', '25.033'],
          ['lng', '121.564'],
          ['region', '台北'],
        ],
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toEqual([
      ['lat', 'REDACTED'],
      ['lng', 'REDACTED'],
      ['region', '台北'],
    ]);
  });

  it('沒有 request 欄位的 event（如部分 error event）不丟例外，照常回傳', () => {
    const event = baseEvent();

    expect(() => redactSentryEvent(event)).not.toThrow();
    const result = redactSentryEvent(event);
    expect(result.request).toBeUndefined();
  });

  // 與 privacyRedaction 的 fail-closed 修正一致：request.url 經 redactCoordsFromUrl
  // 處理，畸形 percent-encoding 的 key（如 lat%）要整段 query 捨棄，不能讓座標漏出。
  it('request.url 帶畸形 percent-encoding 的 key 時，fail closed 捨棄整段 query', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues?sort=distance&lat%=25.033&lng=121.564',
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.url).toBe('https://api.stellar-zone.com/api/venues');
  });

  it('request 存在但沒有 query_string／url 時不受影響', () => {
    const event = baseEvent({ request: { method: 'GET' } });

    const result = redactSentryEvent(event);

    expect(result.request).toEqual({ method: 'GET' });
  });
});

describe('redactSentryEvent — transaction spans', () => {
  it('span.data 的 http.url／http.target 被遮蔽，其餘 data 維持原樣', () => {
    const event = baseEvent({
      type: 'transaction',
      spans: [
        {
          data: {
            'http.url': 'https://api.stellar-zone.com/api/venues?lat=25.033&lng=121.564',
            'http.target': '/api/venues?lat=25.033&lng=121.564',
            'http.method': 'GET',
          },
          span_id: 'span-1',
          start_timestamp: 0,
          trace_id: 'trace-1',
        },
      ],
    });

    const result = redactSentryEvent(event);
    const spanData = result.spans?.[0]?.data as Record<string, unknown>;

    expect(spanData['http.url']).not.toContain('25.033');
    expect(spanData['http.target']).not.toContain('121.564');
    expect(spanData['http.method']).toBe('GET');
  });

  it('span.data 的 http.query／url.query（純 query string）被遮蔽', () => {
    const event = baseEvent({
      type: 'transaction',
      spans: [
        {
          data: {
            'http.query': '?lat=25.033&lng=121.564',
            'url.query': 'lat=25.033&lng=121.564',
          },
          span_id: 'span-1',
          start_timestamp: 0,
          trace_id: 'trace-1',
        },
      ],
    });

    const result = redactSentryEvent(event);
    const spanData = result.spans?.[0]?.data as Record<string, unknown>;

    expect(spanData['http.query']).not.toContain('25.033');
    expect(spanData['url.query']).not.toContain('121.564');
  });

  it('url.full 被遮蔽', () => {
    const event = baseEvent({
      type: 'transaction',
      spans: [
        {
          data: { 'url.full': 'https://api.stellar-zone.com/api/venues?lat=25.033&lng=121.564' },
          span_id: 'span-1',
          start_timestamp: 0,
          trace_id: 'trace-1',
        },
      ],
    });

    const result = redactSentryEvent(event);
    const spanData = result.spans?.[0]?.data as Record<string, unknown>;

    expect(spanData['url.full']).not.toContain('25.033');
  });

  it('沒有 spans 的 event（如一般 error event）不丟例外', () => {
    const event = baseEvent();
    expect(() => redactSentryEvent(event)).not.toThrow();
  });

  it('多個 span 時每個都各自被處理，不互相影響', () => {
    const event = baseEvent({
      type: 'transaction',
      spans: [
        {
          data: { 'http.url': 'https://x.com/a?lat=1&lng=2' },
          span_id: 'span-1',
          start_timestamp: 0,
          trace_id: 'trace-1',
        },
        {
          data: { 'http.url': `https://x.com/b?region=${encodeURIComponent('台北')}` },
          span_id: 'span-2',
          start_timestamp: 0,
          trace_id: 'trace-1',
        },
      ],
    });

    const result = redactSentryEvent(event);

    expect((result.spans?.[0]?.data as Record<string, unknown>)['http.url']).toContain('REDACTED');
    expect((result.spans?.[1]?.data as Record<string, unknown>)['http.url']).toBe(
      `https://x.com/b?region=${encodeURIComponent('台北')}`
    );
  });
});

describe('redactSentryEvent — contexts.trace.data', () => {
  it('contexts.trace.data 裡的 URL/query 欄位被遮蔽', () => {
    const event = baseEvent({
      type: 'transaction',
      contexts: {
        trace: {
          span_id: 'span-1',
          trace_id: 'trace-1',
          data: {
            'http.url': 'https://api.stellar-zone.com/api/venues?lat=25.033&lng=121.564',
          },
        },
      },
    });

    const result = redactSentryEvent(event);

    expect(
      (result.contexts?.trace?.data as Record<string, unknown> | undefined)?.['http.url']
    ).not.toContain('25.033');
  });

  it('沒有 contexts 或 contexts.trace 的 event 不丟例外', () => {
    expect(() => redactSentryEvent(baseEvent())).not.toThrow();
    expect(() => redactSentryEvent(baseEvent({ contexts: {} }))).not.toThrow();
  });
});

describe('redactSentryEvent — 永遠回傳 event，不丟事件', () => {
  it('遮蔽後回傳同一個 event 參考（mutate in place），而不是 null', () => {
    const event = baseEvent({ request: { url: '/api/venues?lat=25.033&lng=121.564' } });

    const result = redactSentryEvent(event);

    expect(result).toBe(event);
    expect(result).not.toBeNull();
  });

  it('不含任何座標的一般 event 原樣回傳（不報錯、不遺失欄位）', () => {
    const event = baseEvent({
      message: 'Something went wrong',
      request: { url: '/api/health', method: 'GET' },
    });

    const result = redactSentryEvent(event);

    expect(result.message).toBe('Something went wrong');
    expect(result.request).toEqual({ url: '/api/health', method: 'GET' });
  });
});
