import { Timestamp } from 'firebase-admin/firestore';
import { UserService } from '../../src/services/userService';
import { cache } from '../../src/utils/cache';

/**
 * Regression test for the createdByEmail leak (F-01, fixed in d83d96c).
 * Exercises the actual UserService.getFavorites call path — not just the
 * toPublicEvent utility in isolation — so a future refactor that drops the
 * sanitizer call when building eventsMap fails a test instead of shipping.
 */

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const mockFavoritesGet = jest.fn();
const mockEventsGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn((name: string) => ({
      where: jest.fn(() => ({
        get: name === 'userFavorites' ? mockFavoritesGet : mockEventsGet,
      })),
    })),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

describe('GET /users/favorites 巢狀 event 物件不含 createdByEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();

    mockFavoritesGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'fav-1',
          data: () => ({
            userId: 'user-1',
            eventId: 'event-1',
            createdAt: makeTimestamp('2025-01-01'),
          }),
        },
      ],
    });

    mockEventsGet.mockResolvedValue({
      docs: [
        {
          id: 'event-1',
          data: () => ({
            title: 'Event',
            description: '',
            location: { name: 'Venue', address: 'Address', coordinates: { lat: 25, lng: 121 } },
            artists: [],
            datetime: { start: makeTimestamp('2025-01-01'), end: makeTimestamp('2025-01-02') },
            status: 'approved',
            createdBy: 'uid-owner',
            createdByEmail: 'owner@example.com',
          }),
        },
      ],
    });
  });

  it('已登入使用者查詢收藏列表，巢狀 event 不含 createdByEmail', async () => {
    const result = await new UserService().getFavorites('user-1', { status: 'all' });

    expect(result.favorites).toHaveLength(1);
    expect(result.favorites[0].event).not.toHaveProperty('createdByEmail');
  });
});
