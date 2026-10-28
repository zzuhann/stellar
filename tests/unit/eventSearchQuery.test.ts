import express from 'express';
import request from 'supertest';
import eventRoutes from '../../src/routes/eventRoutes';
import { EventService } from '../../src/services/eventService';

// /events/search and /events/trending must not 500 or misread malformed query strings.

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn() },
  db: {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: [] }) })),
    })),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

const buildApp = () => {
  const app = express();
  app.use('/api/events', eventRoutes);
  return app;
};

describe('GET /api/events/search 查詢參數', () => {
  it.each(['query', 'artistName', 'location'])(
    '%s 參數重複帶兩次：取第一個，回 200 而不是 500',
    async param => {
      const response = await request(buildApp()).get(`/api/events/search?${param}=a&${param}=b`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    }
  );
});

describe('GET /api/events/trending 的 limit 參數', () => {
  it.each([
    ['2abc（不是完整數字）', '?limit=2abc', 10],
    ['沒帶', '', 10],
    ['空字串', '?limit=', 10],
    ['正常數字', '?limit=5', 5],
    ['重複帶兩次', '?limit=3&limit=7', 3],
  ])('limit %s（%s）→ service 收到 %i', async (_label, qs, expected) => {
    const spy = jest.spyOn(EventService.prototype, 'getTrendingEvents');

    const response = await request(buildApp()).get(`/api/events/trending${qs}`);

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(expected);
    spy.mockRestore();
  });
});
