import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import userRoutes from '../../src/routes/userRoutes';
import { cache } from '../../src/utils/cache';

/**
 * Regression test for the createdByEmail leak (F-01, fixed in d83d96c).
 * Drives the real Express route — router → authenticateToken → controller →
 * service → res.json() — via supertest, instead of calling UserService
 * directly. This exercises the actual HTTP response body, which is where
 * F-01 was observed, so a future call site that bypasses toPublicEvent()
 * when building the nested event object fails this test instead of shipping.
 *
 * All routes in userRoutes.ts require authenticateToken, so the request
 * below carries a Bearer token; auth.verifyIdToken and the Firestore user
 * role lookup it triggers are mocked.
 */

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
    cache.clear();

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

  it('回應 body 巢狀的 event 物件不含 createdByEmail', async () => {
    const response = await request(buildApp())
      .get('/api/users/favorites')
      .query({ status: 'all' }) // 避免因活動日期已過而被 notEnded 預設篩選掉
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.favorites).toHaveLength(1);
    expect(response.body.favorites[0].event).not.toHaveProperty('createdByEmail');
  });
});
