import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import eventRoutes from '../../src/routes/eventRoutes';
import { cache } from '../../src/utils/cache';

/**
 * Regression test for the createdByEmail leak (F-01, fixed in d83d96c).
 * Drives the real Express route — router → optionalAuthenticate → controller
 * → service → res.json() — via supertest, instead of calling EventService
 * directly. This exercises the actual HTTP response body, which is where F-01
 * was observed (an anonymous request reading createdByEmail), so a future
 * call site that bypasses toPublicEvent() and writes straight into the
 * response fails this test instead of shipping.
 *
 * GET /events/:id uses optionalAuthenticate (not authenticateToken), so the
 * anonymous case below is a plain request with no Authorization header.
 */

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
    cache.clear();
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

  it('回應 body 不含 createdByEmail', async () => {
    const response = await request(buildApp()).get('/api/events/event-1');

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('createdByEmail');
  });
});
