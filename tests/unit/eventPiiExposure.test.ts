import { Timestamp } from 'firebase-admin/firestore';
import { EventService } from '../../src/services/eventService';
import { cache } from '../../src/utils/cache';

/**
 * Regression test for the createdByEmail leak (F-01, fixed in d83d96c).
 * Exercises the actual EventService.getEventById call path — not just the
 * toPublicEvent utility in isolation — so a future refactor that drops the
 * sanitizer call from prepareEventForResponse fails a test instead of shipping.
 */

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const mockEventGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: mockEventGet })),
    })),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

describe('GET /events/:id（匿名）回應不含 createdByEmail', () => {
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

  it('未帶 Authorization header 呼叫 getEventById，回應不含 createdByEmail', async () => {
    const event = await new EventService().getEventById('event-1');

    expect(event).not.toBeNull();
    expect(event).not.toHaveProperty('createdByEmail');
  });
});
