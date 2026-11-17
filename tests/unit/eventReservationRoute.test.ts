import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import eventRoutes from '../../src/routes/eventRoutes';
import { cache } from '../../src/utils/cache';

const makeTimestamp = (isoDate: string): Timestamp =>
  ({
    toDate: () => new Date(isoDate),
    toMillis: () => new Date(isoDate).getTime(),
    _seconds: Math.floor(new Date(isoDate).getTime() / 1000),
    _nanoseconds: 0,
  }) as unknown as Timestamp;

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

const reservationDoc = {
  id: 'event-1',
  data: () => ({
    title: 'Event',
    slug: 'event-slug',
    mainImage: 'https://img.example.com/a.jpg',
    description: 'secret description text',
    location: { name: 'Venue', address: 'Address', coordinates: { lat: 25, lng: 121 } },
    artists: [{ id: 'artist-1', name: 'Artist', slug: 'artist' }],
    datetime: { start: makeTimestamp('2025-01-01'), end: makeTimestamp('2099-01-01') },
    status: 'approved',
    createdAt: makeTimestamp('2024-12-01'),
    createdBy: 'uid-owner',
    createdByEmail: 'owner@example.com',
    reservation: { url: 'https://example.com/book', startAt: makeTimestamp('2098-01-01') },
  }),
};

describe('GET /events/reservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clearPattern('events:');
  });

  // TC-001
  it('is public and not swallowed by /:id', async () => {
    mockApprovedEventsGet.mockResolvedValue({ docs: [reservationDoc] });

    const response = await request(buildApp()).get('/api/events/reservations');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1 });
    expect(response.body.events).toHaveLength(1);
  });

  // TC-002
  it('returns only whitelisted fields and no PII', async () => {
    mockApprovedEventsGet.mockResolvedValue({ docs: [reservationDoc] });

    const response = await request(buildApp()).get('/api/events/reservations');

    expect(response.status).toBe(200);
    const [item] = response.body.events;
    expect(Object.keys(item).sort()).toEqual(
      ['artists', 'datetime', 'id', 'mainImage', 'reservation', 'slug', 'title'].sort()
    );
    const text = JSON.stringify(response.body);
    for (const leaked of [
      'createdBy',
      'createdByEmail',
      'status',
      'description',
      'location',
      'owner@example.com',
      'uid-owner',
    ]) {
      expect(text).not.toContain(leaked);
    }
  });

  // TC-003
  it('returns 200 with empty list when nothing qualifies', async () => {
    mockApprovedEventsGet.mockResolvedValue({ docs: [] });

    const response = await request(buildApp()).get('/api/events/reservations');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ events: [], total: 0 });
  });
});
