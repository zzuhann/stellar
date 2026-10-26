import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import eventRoutes from '../../src/routes/eventRoutes';

// Regression for F-01 (d83d96c): createdByEmail must not reach the HTTP response, cached or not.

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const mockEventGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn() },
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: mockEventGet })),
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

describe('GET /api/events/:id（匿名，未帶 Authorization header）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventGet.mockResolvedValue({
      exists: true,
      id: 'event-1',
      data: () => ({
        title: 'Event',
        description: '',
        location: { name: 'Venue', address: 'Address', coordinates: { lat: 25, lng: 121 } },
        artists: [{ id: 'artist-1', name: 'Artist', slug: 'artist' }], // slug 已存在，避免額外 mock artists collection
        datetime: { start: makeTimestamp('2025-01-01'), end: makeTimestamp('2025-01-02') },
        status: 'approved',
        createdBy: 'uid-owner',
        createdByEmail: 'owner@example.com',
      }),
    });
  });

  it('回應 body 不含投稿者 email（含第二次走快取）', async () => {
    const app = buildApp();

    for (let i = 0; i < 2; i++) {
      const response = await request(app).get('/api/events/event-1');

      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('owner@example.com');
    }
  });
});
