import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import eventRoutes from '../../src/routes/eventRoutes';
import { cache } from '../../src/utils/cache';

// Regression for F-01 (d83d96c): anonymous list endpoints must not expose createdByEmail, cached or not.

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const mockApprovedEventsGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn() },
  db: {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({ get: mockApprovedEventsGet })),
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

type ListBody = { events?: unknown[] } | unknown[];
const eventsOf = (body: ListBody) => (Array.isArray(body) ? body : (body.events ?? []));

describe('匿名呼叫活動列表端點', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApprovedEventsGet.mockResolvedValue({
      docs: [
        {
          id: 'event-1',
          data: () => ({
            title: 'Event',
            description: '',
            location: { name: 'Venue', address: 'Address', coordinates: { lat: 25, lng: 121 } },
            artists: [{ id: 'artist-1', name: 'Artist', slug: 'artist' }],
            // still running, so it passes the active / not-ended filters
            datetime: { start: makeTimestamp('2025-01-01'), end: makeTimestamp('2099-01-01') },
            status: 'approved',
            createdAt: makeTimestamp('2024-12-01'),
            createdBy: 'uid-owner',
            createdByEmail: 'owner@example.com',
          }),
        },
      ],
    });
  });

  it.each(['/api/events', '/api/events/search', '/api/events/trending', '/api/events/map-data'])(
    'GET %s 回應 body 不含投稿者 email（含第二次走快取）',
    async path => {
      const app = buildApp();

      for (let i = 0; i < 2; i++) {
        const response = await request(app).get(path);

        expect(response.status).toBe(200);
        const events = eventsOf(response.body);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ id: 'event-1', title: 'Event' });
        expect(events[0]).not.toHaveProperty('createdByEmail');
        expect(JSON.stringify(response.body)).not.toContain('owner@example.com');
      }

      expect(mockApprovedEventsGet).toHaveBeenCalledTimes(1); // second request was served from cache
    }
  );

  it('共用快取層本身不存投稿者 email（新增的公開端點也拿不到）', async () => {
    await request(buildApp()).get('/api/events/map-data');

    const cached = cache.get('events:approved:active');
    expect(cached).toHaveLength(1);
    expect(JSON.stringify(cached)).not.toContain('owner@example.com');
  });
});
