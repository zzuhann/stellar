import request from 'supertest';
import app from '../../src/app';

// CORS 拒絕的來源應該回 403（AppError），不能落成 500 INTERNAL_ERROR
// 背景：bot 掃描不在白名單的 Origin，過去 CORS callback 丟一般 Error，
// 被全域錯誤處理 normalize 成 500，污染 Sentry 監控（2026-09-25 健檢發現）
describe('CORS rejection', () => {
  test('未在白名單的 Origin 回 403 而不是 500', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil-bot.example.com');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CORS_NOT_ALLOWED');
    expect(res.status).not.toBe(500);
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
