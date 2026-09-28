// @sentry/node 的 module exports 是唯讀（非 configurable），jest.spyOn 會噴
// "Cannot redefine property"，比照 corsRejection.test.ts 用 jest.mock factory
// 只換掉 captureException，其餘保留 actual 實作。
jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

import { redactCoordsFromUrl } from '../../src/app';

// 對應 specs/features/venue-distance-sort/qa.md 後端情境 13：
// morgan url token 遮蔽 lat/lng，避免使用者座標寫進 Cloud Run request log。
describe('redactCoordsFromUrl', () => {
  it('情境 13a：遮蔽 lat/lng 值，其餘參數（如 region）維持原樣', () => {
    const result = redactCoordsFromUrl('/api/venues?sort=distance&lat=25.033&lng=121.564&region=台北');
    expect(result).toContain('lat=REDACTED');
    expect(result).toContain('lng=REDACTED');
    expect(result).not.toContain('25.033');
    expect(result).not.toContain('121.564');
    expect(result).toContain('region=');
    expect(result).toContain('sort=distance');
  });

  it('情境 13b：不含 lat/lng 的 URL 不受影響，無多餘替換痕跡', () => {
    const original = '/api/venues?sort=composite&region=台北';
    const result = redactCoordsFromUrl(original);
    expect(result).toBe(original);
  });

  it('沒有 query string 的 URL 原樣返回', () => {
    expect(redactCoordsFromUrl('/api/health')).toBe('/api/health');
  });

  it('無法解析的 URL 時安全 fallback 回原始字串，不丟例外', () => {
    // encodeURIComponent 不完整的 malformed query 讓 URLSearchParams/decodeURIComponent 可能丟例外
    const malformed = '/api/venues?lat=%';
    expect(() => redactCoordsFromUrl(malformed)).not.toThrow();
  });
});
