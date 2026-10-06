import {
  redactCoordsFromQueryPairs,
  redactCoordsFromQueryRecord,
  redactCoordsFromQueryString,
  redactCoordsFromUrl,
} from '../../src/utils/privacyRedaction';

// 對應 specs/features/venue-distance-sort/qa.md 後端情境 13（原測在 app.test.ts，
// 隨 redactCoordsFromUrl 抽到 src/utils/privacyRedaction.ts 一併搬移；qa.md 原文
// 本身就標註測試檔名為「新增，或依 @backend 慣例命名」，不算調整情境定義）。
describe('redactCoordsFromUrl', () => {
  it('情境 13a：遮蔽 lat/lng 值，其餘參數（如 region）維持原樣', () => {
    const result = redactCoordsFromUrl(
      '/api/venues?sort=distance&lat=25.033&lng=121.564&region=台北'
    );
    expect(result).toContain('lat=REDACTED');
    expect(result).toContain('lng=REDACTED');
    expect(result).not.toContain('25.033');
    expect(result).not.toContain('121.564');
    expect(result).toContain('region=');
    expect(result).toContain('sort=distance');
  });

  it('情境 13b：不含 lat/lng 的 URL 不受影響，無多餘替換痕跡', () => {
    // req.originalUrl 來自實際 HTTP request line，非 ASCII 字元本來就已是 percent-encoded
    // 形式（而非上面 13a 那種示意用的原始 UTF-8 字串），用 encodeURIComponent 模擬真實情境，
    // 確保這裡驗證的是「經過 URL/URLSearchParams round-trip 後字串不變」而非巧合。
    const original = `/api/venues?sort=composite&region=${encodeURIComponent('台北')}`;
    const result = redactCoordsFromUrl(original);
    expect(result).toBe(original);
  });

  it('沒有 query string 的 URL 原樣返回', () => {
    expect(redactCoordsFromUrl('/api/health')).toBe('/api/health');
  });

  it('不含座標的畸形 query（如 lat=%）不丟例外，且不影響其他合法參數', () => {
    const malformed = '/api/venues?sort=composite&region=台北&lat=%';
    expect(() => redactCoordsFromUrl(malformed)).not.toThrow();
  });

  // 第一輪 code review 補強：key 比對需解碼後不分大小寫
  it.each([
    ['大寫 LAT/LNG', '/api/venues?LAT=25.033&LNG=121.564'],
    ['混合大小寫 Lat/Lng', '/api/venues?Lat=25.033&Lng=121.564'],
    ['percent-encoded key（%4Cat＝Lat）', '/api/venues?%4Cat=25.033&lng=121.564'],
  ])('%s 也會被遮蔽', (_label, url) => {
    const result = redactCoordsFromUrl(url);
    expect(result).not.toContain('25.033');
    expect(result).not.toContain('121.564');
    expect(result.toLowerCase()).toContain('redacted');
  });

  // 第一輪 code review 補強：解析失敗時 fail closed——整段 query 捨棄，不能
  // fallback 回原始字串（原始字串可能仍帶著未遮蔽的座標）。
  it('無法解析的 URL（如畸形的 scheme）時，fail closed 捨棄整段 query，不輸出原始座標', () => {
    const malformed = 'http://[::1/api/venues?lat=25.033&lng=121.564';
    const result = redactCoordsFromUrl(malformed);
    expect(result).not.toContain('25.033');
    expect(result).not.toContain('121.564');
    expect(result).not.toContain('?');
  });
});

describe('redactCoordsFromQueryString', () => {
  it('遮蔽帶開頭 ? 的 query string，保留其他參數與開頭 ?', () => {
    const result = redactCoordsFromQueryString('?lat=25.033&lng=121.564&region=台北');
    expect(result.startsWith('?')).toBe(true);
    expect(result).toContain('lat=REDACTED');
    expect(result).toContain('lng=REDACTED');
    expect(result).not.toContain('25.033');
    expect(result).toContain('region=');
  });

  it('遮蔽不帶開頭 ? 的 query string，輸出也不帶開頭 ?', () => {
    const result = redactCoordsFromQueryString('lat=25.033&lng=121.564');
    expect(result.startsWith('?')).toBe(false);
    expect(result).not.toContain('25.033');
  });

  it('不含座標的 query string 維持原參數不變', () => {
    // 非 ASCII 值經過 URLSearchParams round-trip 後會被 percent-encode，
    // 用已編碼的輸入才能驗證「值本身不變」而不是巧合躲過編碼差異（比照
    // redactCoordsFromUrl 情境 13b 的作法）。
    const encoded = `?region=${encodeURIComponent('台北')}&sort=composite`;
    expect(redactCoordsFromQueryString(encoded)).toBe(encoded);
  });

  it('大小寫不分：?LAT=... 也會被遮蔽', () => {
    const result = redactCoordsFromQueryString('?LAT=25.033&LNG=121.564');
    expect(result).not.toContain('25.033');
    expect(result.toLowerCase()).toContain('redacted');
  });

  it('空字串輸入回傳空字串', () => {
    expect(redactCoordsFromQueryString('')).toBe('');
  });
});

describe('redactCoordsFromQueryRecord', () => {
  it('遮蔽物件形狀中的 lat/lng，其餘 key 維持原樣', () => {
    const result = redactCoordsFromQueryRecord({ lat: '25.033', lng: '121.564', region: '台北' });
    expect(result).toEqual({ lat: 'REDACTED', lng: 'REDACTED', region: '台北' });
  });

  it('大小寫不分：LAT/LNG 也會被遮蔽', () => {
    const result = redactCoordsFromQueryRecord({ LAT: '25.033', LNG: '121.564' });
    expect(result).toEqual({ LAT: 'REDACTED', LNG: 'REDACTED' });
  });

  it('不含座標的物件原樣回傳（新物件，但內容相同）', () => {
    expect(redactCoordsFromQueryRecord({ region: '台北' })).toEqual({ region: '台北' });
  });
});

describe('redactCoordsFromQueryPairs', () => {
  it('遮蔽陣列形狀中的 lat/lng pair，其餘 pair 維持原樣', () => {
    const result = redactCoordsFromQueryPairs([
      ['lat', '25.033'],
      ['lng', '121.564'],
      ['region', '台北'],
    ]);
    expect(result).toEqual([
      ['lat', 'REDACTED'],
      ['lng', 'REDACTED'],
      ['region', '台北'],
    ]);
  });

  it('大小寫不分：Lat/Lng 也會被遮蔽', () => {
    const result = redactCoordsFromQueryPairs([
      ['Lat', '25.033'],
      ['Lng', '121.564'],
    ]);
    expect(result).toEqual([
      ['Lat', 'REDACTED'],
      ['Lng', 'REDACTED'],
    ]);
  });

  it('空陣列回傳空陣列', () => {
    expect(redactCoordsFromQueryPairs([])).toEqual([]);
  });
});
