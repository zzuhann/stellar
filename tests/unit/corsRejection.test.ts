import request from 'supertest';

// @sentry/node 的 module exports 是唯讀（非 configurable），jest.spyOn 會噴
// "Cannot redefine property"，所以用 jest.mock factory 只換掉 captureException，
// 其餘（如 setupExpressErrorHandler）保留 actual 實作
jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

// 型別引入放在 mock 之後不影響 hoist（jest.mock 會被 hoist 到最上面）
import * as Sentry from '@sentry/node';
import app from '../../src/app';

const mockCaptureException = Sentry.captureException as jest.Mock;

// CORS 拒絕的來源應該回 403（AppError），不能落成 500 INTERNAL_ERROR
// 背景：bot 掃描不在白名單的 Origin，過去 CORS callback 丟一般 Error，
// 被全域錯誤處理 normalize 成 500，污染 Sentry 監控（2026-09-25 健檢發現）
describe('CORS rejection', () => {
  beforeEach(() => {
    mockCaptureException.mockClear();
  });

  test('未在白名單的 Origin 回 403 而不是 500', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil-bot.example.com');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CORS_NOT_ALLOWED');
    expect(res.status).not.toBe(500);
  });

  test('未在白名單的 Origin 不會帶任何 Access-Control-Allow-* header，也不會觸發 Sentry', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil-bot.example.com');

    const accessControlHeaders = Object.keys(res.headers).filter(h =>
      h.toLowerCase().startsWith('access-control-allow')
    );
    expect(accessControlHeaders).toHaveLength(0);
    // 只涵蓋 app.ts 全域錯誤處理直接呼叫 captureException 的路徑；Sentry SDK 的
    // setupExpressErrorHandler 在內部上報不經過這個 mock，那條路靠 SDK 預設只上報 status >= 500
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  test('合法 origin 的 OPTIONS preflight 回 204 並帶正確的 CORS header', async () => {
    const res = await request(app)
      .options('/api/events')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });

  test('合法的 Vercel preview origin 通過', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'https://stellar-abc123-zzuhanns-projects.vercel.app');

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://stellar-abc123-zzuhanns-projects.vercel.app'
    );
  });

  test.each([
    // 合法 pattern 的後綴誤配（貌似 vercel preview，實際多了額外網域）
    'https://stellar-x-zzuhanns-projects.vercel.app.evil.com',
    // 合法白名單網域的子字串誤配
    'https://evil-stellar-zone.com',
  ])('相似但不合法的網域 %s 回 403', async origin => {
    const res = await request(app).get('/').set('Origin', origin);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CORS_NOT_ALLOWED');
  });

  test('白名單內的 Origin 正常通過（不觸發 CORS 拒絕）', async () => {
    const res = await request(app).get('/').set('Origin', 'http://localhost:3000');

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  test('沒有 Origin header 的請求（server-to-server / curl / UptimeRobot）正常通過', async () => {
    const res = await request(app).get('/');

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });

  test('OPTIONS preflight 被拒的 Origin 也回 403 而不是 500', async () => {
    const res = await request(app)
      .options('/api/events')
      .set('Origin', 'https://evil-bot.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
  });
});
