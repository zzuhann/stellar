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

  // 第三輪 code review 補強：request.url 存在時，query_string 不再獨立處理，一律
  // 以遮蔽後的 request.url 重新產生——因為 query_string 可能來自上游容錯 parser
  // 對畸形 percent-encoding 的解析結果（例如把 `la%74%=25.033` 解析成
  // `{'lat%': '25.033'}`），這種資料沒有 raw string 可以重新驗證，獨立判斷有
  // 漏判風險。以下三個測試驗證：無論 query_string 原本是什麼形狀（string/物件/
  // 陣列）、內容是否乾淨，只要 request.url 存在，輸出永遠是「以遮蔽後 url 重新
  // 切出的 string」，不會殘留 query_string 原始內容。
  it('request.url 存在時，query_string（string 形狀）完全由遮蔽後的 url 重新產生', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues?sort=distance&lat=25.033&lng=121.564',
        query_string: '?lat=25.033&lng=121.564',
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toBe('?sort=distance&lat=REDACTED&lng=REDACTED');
  });

  it('request.url 存在時，query_string（物件形狀，含容錯 parser 可能產生的畸形 key）完全由遮蔽後的 url 重新產生', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues?sort=distance&lat=25.033&lng=121.564',
        // 模擬容錯 parser 把 `la%74%=25.033` 解析成 `{'lat%': '25.033'}` 殘留下來的
        // 畸形 key；因為 request.url 存在，這個物件的內容會被完全忽略、不會殘留。
        query_string: { 'lat%': '25.033', lng: '121.564', region: '台北' },
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toBe('?sort=distance&lat=REDACTED&lng=REDACTED');
  });

  it('request.url 存在時，query_string（[key,value][] 陣列形狀）完全由遮蔽後的 url 重新產生', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues?sort=distance&lat=25.033&lng=121.564',
        query_string: [
          ['lat%', '25.033'],
          ['lng', '121.564'],
          ['region', '台北'],
        ],
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toBe('?sort=distance&lat=REDACTED&lng=REDACTED');
  });

  it('request.url 因畸形 percent-encoding fail closed（整段 query 被捨棄）時，query_string 一併清空為空字串', () => {
    const event = baseEvent({
      request: {
        url: 'https://api.stellar-zone.com/api/venues?sort=distance&lat%=25.033&lng=121.564',
        // 即使 query_string 本身長得「乾淨」，也要以 url 的遮蔽結果為準一併清空，
        // 不能因為 query_string 看起來沒問題就讓它殘留座標資訊。
        query_string: { lat: '25.033', lng: '121.564' },
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.url).toBe('https://api.stellar-zone.com/api/venues');
    expect(result.request?.query_string).toBe('');
  });

  // request.url 不存在時，query_string 是唯一資訊來源，只能就地保守處理：容錯
  // parser 可能已經把畸形 percent-encoding decode 到一半（如 `lat%`、`lat%25`），
  // 這類 key 轉小寫後以 lat/lng 開頭就一併遮蔽，即使不完全等於 lat/lng。
  it('沒有 request.url 時，query_string 物件形狀中「像座標 key」的畸形 key（lat%、lat%25）也保守遮蔽，正常 lat/lng 與非座標參數不受影響', () => {
    const event = baseEvent({
      request: {
        query_string: {
          'lat%': '25.033',
          'lat%25': '25.1',
          lng: '121.564',
          region: '台北',
        },
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.query_string).toEqual({
      'lat%': 'REDACTED',
      'lat%25': 'REDACTED',
      lng: 'REDACTED',
      region: '台北',
    });
  });

  it('沒有 request.url 時，query_string 陣列形狀的正常 lat/lng 仍被遮蔽，非座標參數不受影響', () => {
    const event = baseEvent({
      request: {
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

// The SDK attaches incoming request bodies (up to 10KB), Authorization and cookies by
// default; a probe on @sentry/node 10.63.0 confirmed all three reach beforeSend.
describe('redactSentryEvent — request body／header 個資', () => {
  it('JSON 字串 body 只留欄位形狀（型別與長度），不留任何值', () => {
    const event = baseEvent({
      request: {
        data: JSON.stringify({
          email: 'user@example.com',
          message: 'hello world',
          artists: [{ id: 'a1' }, { id: 'a2' }],
          location: { address: '台北市大安區', coordinates: { lat: 25.03, lng: 121.56 } },
          count: 3,
          agreed: true,
          note: null,
        }),
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.data).toEqual({
      email: 'string(16)',
      message: 'string(11)',
      artists: 'array(2)',
      location: { address: 'string(6)', coordinates: 'object(2)' },
      count: 'number',
      agreed: 'boolean',
      note: 'null',
    });
    expect(JSON.stringify(result.request)).not.toMatch(/user@example\.com|hello|台北|25\.03/);
  });

  it('已經是物件的 body 一樣只留形狀', () => {
    const event = baseEvent({ request: { data: { displayName: 'Zoe' } } });

    expect(redactSentryEvent(event).request?.data).toEqual({ displayName: 'string(3)' });
  });

  it('不是 JSON 的字串 body（例如 form 編碼）只留長度', () => {
    const event = baseEvent({ request: { data: 'email=user%40example.com&message=hi' } });

    const result = redactSentryEvent(event);

    expect(result.request?.data).toBe('[Filtered] string(35)');
  });

  it('Authorization、Cookie 等憑證 header 換成 [Filtered]（不分大小寫），其他 header 保留', () => {
    const event = baseEvent({
      request: {
        headers: {
          Authorization: 'Bearer SECRET_TOKEN',
          cookie: 'session=abc',
          'proxy-authorization': 'Basic xyz',
          'user-agent': 'Mozilla/5.0',
        },
        cookies: { session: 'abc' },
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.headers).toEqual({
      Authorization: '[Filtered]',
      cookie: '[Filtered]',
      'proxy-authorization': '[Filtered]',
      'user-agent': 'Mozilla/5.0',
    });
    expect(result.request?.cookies).toBeUndefined();
    expect(JSON.stringify(result.request)).not.toMatch(/SECRET_TOKEN|session=abc|xyz/);
  });

  it('沒有 body／header 的 request 不受影響', () => {
    const event = baseEvent({
      request: { method: 'GET', url: 'https://api.stellar-zone.com/api/events' },
    });

    const result = redactSentryEvent(event);

    expect(result.request).toEqual({
      method: 'GET',
      url: 'https://api.stellar-zone.com/api/events',
    });
  });
});

describe('redactSentryEvent — 其他個資管道', () => {
  it('名稱含 session／token／key 等字樣的 header 也換成 [Filtered]（例如前端每個請求都帶的 x-session-id）', () => {
    const event = baseEvent({
      request: {
        headers: {
          'x-session-id': 'sess-123',
          'x-api-key': 'k-456',
          'X-CSRF-Token': 'c-789',
          'content-type': 'application/json',
        },
      },
    });

    const result = redactSentryEvent(event);

    expect(result.request?.headers).toEqual({
      'x-session-id': '[Filtered]',
      'x-api-key': '[Filtered]',
      'X-CSRF-Token': '[Filtered]',
      'content-type': 'application/json',
    });
  });

  it('console breadcrumb 的 message 與 arguments 裡的 email 換成 [email]', () => {
    const line = '[email] approval sent to someone@example.com for event abc';
    const event = baseEvent({
      breadcrumbs: [
        {
          category: 'console',
          message: line,
          data: { arguments: [line, { to: 'a.b+c@mail.co' }] },
        },
      ],
    });

    const result = redactSentryEvent(event);

    expect(result.breadcrumbs?.[0].message).toBe('[email] approval sent to [email] for event abc');
    expect(JSON.stringify(result.breadcrumbs)).not.toMatch(/someone@example\.com|a\.b\+c@mail\.co/);
  });

  it('trace／span data 的使用者 IP（http.client_ip、client.address）換成 [Filtered]', () => {
    const event = baseEvent({
      contexts: { trace: { trace_id: 't', span_id: 's', data: { 'http.client_ip': '1.2.3.4' } } },
      spans: [
        {
          span_id: 's2',
          trace_id: 't',
          start_timestamp: 0,
          data: { 'client.address': '5.6.7.8', 'http.method': 'GET' },
        },
      ],
    } as Partial<Event>);

    const result = redactSentryEvent(event);

    expect(result.contexts?.trace?.data?.['http.client_ip']).toBe('[Filtered]');
    expect(result.spans?.[0].data).toEqual({
      'client.address': '[Filtered]',
      'http.method': 'GET',
    });
  });

  it('body 的欄位名稱如果本身是 email，也換成 [email]', () => {
    const event = baseEvent({ request: { data: { 'user@example.com': { role: 'admin' } } } });

    expect(redactSentryEvent(event).request?.data).toEqual({ '[email]': { role: 'string(5)' } });
  });
});

describe('redactSentryEvent — Codex 第 1 輪', () => {
  it('很長且沒有 email 的字串不會讓 email 比對變慢（避免 ReDoS 卡住 event loop）', () => {
    const long = 'a'.repeat(40_000);
    const event = baseEvent({
      breadcrumbs: [{ message: long }, { message: `${'x.'.repeat(20_000)}@` }],
    });

    const started = Date.now();
    redactSentryEvent(event);

    expect(Date.now() - started).toBeLessThan(50);
  });

  it('email 在網址路徑中時只遮 email，保留前後路徑', () => {
    const event = baseEvent({ breadcrumbs: [{ message: 'GET /users/user@example.com/events' }] });

    expect(redactSentryEvent(event).breadcrumbs?.[0].message).toBe('GET /users/[email]/events');
  });

  it("email 前半段含單引號（例如 o'connor）時整個遮掉，不留姓名片段", () => {
    const event = baseEvent({ breadcrumbs: [{ message: "sent to o'connor@example.com" }] });

    expect(redactSentryEvent(event).breadcrumbs?.[0].message).toBe('sent to [email]');
  });

  it('span data 裡 SDK 複製的 cookie／set-cookie／敏感 header 屬性換成 [Filtered]', () => {
    const event = baseEvent({
      spans: [
        {
          span_id: 's',
          trace_id: 't',
          start_timestamp: 0,
          data: {
            'http.request.header.cookie.visitor': 'private-id',
            'http.request.header.x_session_id': 'sess-1',
            'http.response.header.set_cookie.sid': 'abc',
            'http.request.header.user_agent': 'Mozilla/5.0',
          },
        },
      ],
    } as Partial<Event>);

    expect(redactSentryEvent(event).spans?.[0].data).toEqual({
      'http.request.header.cookie.visitor': '[Filtered]',
      'http.request.header.x_session_id': '[Filtered]',
      'http.response.header.set_cookie.sid': '[Filtered]',
      'http.request.header.user_agent': 'Mozilla/5.0',
    });
  });
});

describe('redactSentryEvent — 前端 code review 回饋（兩邊共用的邏輯）', () => {
  it('breadcrumb 裡的 Error、Date 等非一般物件原樣保留，不被弄成空物件', () => {
    const error = new Error('Network timeout');
    const when = new Date(0);
    const event = baseEvent({
      breadcrumbs: [{ category: 'console', data: { arguments: [error, when] } }],
    });

    const args = redactSentryEvent(event).breadcrumbs?.[0].data?.arguments as unknown[];

    expect(args[0]).toBe(error);
    expect(args[1]).toBe(when);
  });

  it('巢狀到第 4 層的 email 也會遮（例如 console.log({ user: { email } })）', () => {
    const event = baseEvent({
      breadcrumbs: [
        { data: { arguments: [{ user: { profile: { email: 'deep@example.com' } } }] } },
      ],
    });

    expect(JSON.stringify(redactSentryEvent(event).breadcrumbs)).not.toContain('deep@example.com');
  });

  it('地理位置／IP 類 header 與平台簽章 header 換成 [Filtered]', () => {
    const event = baseEvent({
      request: {
        headers: {
          'x-vercel-ip-latitude': '25.03',
          'x-vercel-ip-longitude': '121.56',
          'x-vercel-ip-city': 'Taipei',
          'x-vercel-ip-postal-code': '106',
          'x-client-geo-location': 'TW',
          'cf-connecting-ip': '1.2.3.4',
          'x-vercel-proxy-signature': 'sig',
          'x-amzn-oidc-identity': 'id',
          accept: 'application/json',
        },
      },
    });

    const headers = redactSentryEvent(event).request?.headers ?? {};

    expect(headers.accept).toBe('application/json');
    for (const [key, value] of Object.entries(headers)) {
      if (key !== 'accept') expect(value).toBe('[Filtered]');
    }
  });

  it('span data 的 net.peer.ip 換成 [Filtered]', () => {
    const event = baseEvent({
      contexts: { trace: { trace_id: 't', span_id: 's', data: { 'net.peer.ip': '1.2.3.4' } } },
    });

    expect(redactSentryEvent(event).contexts?.trace?.data?.['net.peer.ip']).toBe('[Filtered]');
  });

  it('錯誤訊息（exception value、message）裡的 email 換成 [email]', () => {
    const event = baseEvent({
      message: 'lookup failed for a@example.com',
      exception: { values: [{ type: 'Error', value: 'No account for user@example.com' }] },
    });

    const result = redactSentryEvent(event);

    expect(result.message).toBe('lookup failed for [email]');
    expect(result.exception?.values?.[0].value).toBe('No account for [email]');
  });
});

describe('redactSentryEvent — 前端 Codex 第 1 輪（兩邊共用）', () => {
  it('x-forwarded-for、x-vercel-forwarded-for、Forwarded 帶的使用者 IP 換成 [Filtered]；x-forwarded-proto 保留', () => {
    const event = baseEvent({
      request: {
        headers: {
          'x-forwarded-for': '203.0.113.7, 10.0.0.1',
          'x-vercel-forwarded-for': '203.0.113.7',
          Forwarded: 'for=203.0.113.7;proto=https',
          'x-forwarded-proto': 'https',
        },
      },
    });

    expect(redactSentryEvent(event).request?.headers).toEqual({
      'x-forwarded-for': '[Filtered]',
      'x-vercel-forwarded-for': '[Filtered]',
      Forwarded: '[Filtered]',
      'x-forwarded-proto': 'https',
    });
  });

  it('span 上 SDK 把 - 換成 _ 的 header 屬性（x_vercel_ip_city、cf_connecting_ip、x_forwarded_for）也換成 [Filtered]', () => {
    const event = baseEvent({
      spans: [
        {
          span_id: 's',
          trace_id: 't',
          start_timestamp: 0,
          data: {
            'http.request.header.x_vercel_ip_city': 'Taipei',
            'http.request.header.cf_connecting_ip': '1.2.3.4',
            'http.request.header.x_forwarded_for': '1.2.3.4',
            'http.request.header.accept_language': 'zh-TW',
          },
        },
      ],
    } as Partial<Event>);

    expect(redactSentryEvent(event).spans?.[0].data).toEqual({
      'http.request.header.x_vercel_ip_city': '[Filtered]',
      'http.request.header.cf_connecting_ip': '[Filtered]',
      'http.request.header.x_forwarded_for': '[Filtered]',
      'http.request.header.accept_language': 'zh-TW',
    });
  });
});
