import express from 'express';
import request from 'supertest';
import eventRoutes from '../../src/routes/eventRoutes';

// GET /events/search must not 500 on malformed query strings.

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
