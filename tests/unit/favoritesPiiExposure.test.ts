import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import userRoutes from '../../src/routes/userRoutes';

// Regression for F-01 (d83d96c): favorites' nested event must not expose createdByEmail, cached or not.

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const mockVerifyIdToken = jest.fn();
const mockUserRoleGet = jest.fn();
const mockFavoritesGet = jest.fn();
const mockEventsGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return { doc: jest.fn(() => ({ get: mockUserRoleGet })) };
      }
      if (name === 'userFavorites') {
        return { where: jest.fn(() => ({ get: mockFavoritesGet })) };
      }
      // coffeeEvents（收藏內嵌的活動資料）
      return { where: jest.fn(() => ({ get: mockEventsGet })) };
    }),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

const buildApp = () => {
  const app = express();
  app.use('/api/users', userRoutes);
  return app;
};

describe('GET /api/users/favorites（帶有效 Authorization header）', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'user@example.com' });
    mockUserRoleGet.mockResolvedValue({ data: () => ({ role: 'user' }) });

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

  it('回應 body 不含投稿者 email（含第二次走快取）', async () => {
    const app = buildApp();

    for (let i = 0; i < 2; i++) {
      const response = await request(app)
        .get('/api/users/favorites')
        .query({ status: 'all' }) // 避免因活動日期已過而被 notEnded 預設篩選掉
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.favorites).toHaveLength(1);
      expect(response.body.favorites[0].event).toMatchObject({ id: 'event-1', title: 'Event' });
      expect(response.body.favorites[0].event).not.toHaveProperty('createdByEmail');
      expect(JSON.stringify(response.body)).not.toContain('owner@example.com');
    }

    // second request was served from cache
    expect(mockFavoritesGet).toHaveBeenCalledTimes(1);
    expect(mockEventsGet).toHaveBeenCalledTimes(1);
  });
});
