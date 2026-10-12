import request from 'supertest';
import { AppError } from '../../src/utils/AppError';

const mockVerifyIdToken = jest.fn();
const mockPreview = jest.fn();
const mockApply = jest.fn();
const mockGetAdminVenueById = jest.fn();
const mockGetVenueById = jest.fn();

jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: (token: string) => mockVerifyIdToken(token) },
  db: {
    collection: () => ({
      doc: (uid: string) => ({
        get: () =>
          Promise.resolve({ data: () => ({ role: uid === 'admin-uid' ? 'admin' : 'user' }) }),
      }),
    }),
  },
}));

jest.mock('../../src/services/venuePlaceReselectService', () => ({
  preview: (...args: unknown[]) => mockPreview(...args),
  apply: (...args: unknown[]) => mockApply(...args),
}));

jest.mock('../../src/services/venueService', () => ({
  VenueService: jest.fn().mockImplementation(() => ({
    getAdminVenueById: (...args: unknown[]) => mockGetAdminVenueById(...args),
    getVenueById: (...args: unknown[]) => mockGetVenueById(...args),
  })),
}));

import app from '../../src/app';

const PLACE = 'ChIJnewPlaceId123456';
const previewPath = '/api/venues/admin/v1/place-reselect/preview';
const applyPath = '/api/venues/admin/v1/place-reselect';

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyIdToken.mockImplementation((token: string) => {
    if (token === 'admin-token')
      return Promise.resolve({ uid: 'admin-uid', email: 'a@example.com' });
    if (token === 'user-token') return Promise.resolve({ uid: 'user-uid', email: 'u@example.com' });
    return Promise.reject(new Error('bad token'));
  });
});

describe.each([
  ['preview', previewPath, mockPreview],
  ['apply', applyPath, mockApply],
])('POST place-reselect %s', (_name, path, serviceMock) => {
  it('B18 未帶 token 回 401，service 未被呼叫', async () => {
    const res = await request(app).post(path).send({ placeId: PLACE });

    expect(res.status).toBe(401);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('B18 一般使用者回 403 ADMIN_REQUIRED，service 未被呼叫', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', 'Bearer user-token')
      .send({ placeId: PLACE });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_REQUIRED');
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('B19 場地不存在回 404 VENUE_NOT_FOUND', async () => {
    serviceMock.mockRejectedValue(new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found'));

    const res = await request(app)
      .post(path)
      .set('Authorization', 'Bearer admin-token')
      .send({ placeId: PLACE });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('VENUE_NOT_FOUND');
  });

  it('placeId 格式不合回 400 VALIDATION_ERROR，service 未被呼叫', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', 'Bearer admin-token')
      .send({ placeId: 'bad/id' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', field: 'placeId' });
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('錯誤帶 details 時經全域 handler 原樣輸出', async () => {
    serviceMock.mockRejectedValue(
      new AppError(409, 'PLACE_ID_IN_USE', 'in use', undefined, { venue: { id: 'v2', name: 'X' } })
    );

    const res = await request(app)
      .post(path)
      .set('Authorization', 'Bearer admin-token')
      .send({ placeId: PLACE });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'in use',
      code: 'PLACE_ID_IN_USE',
      details: { venue: { id: 'v2', name: 'X' } },
    });
  });
});

describe('B20 路由未被 /:id 吃掉', () => {
  it('兩支新端點進入對應 handler 並帶入參數', async () => {
    mockPreview.mockResolvedValue({ kind: 'preview' });
    mockApply.mockResolvedValue({ kind: 'apply' });

    const previewRes = await request(app)
      .post(previewPath)
      .set('Authorization', 'Bearer admin-token')
      .send({ placeId: PLACE });
    const applyRes = await request(app)
      .post(applyPath)
      .set('Authorization', 'Bearer admin-token')
      .send({ placeId: PLACE, addressChoice: 'google' });

    expect(previewRes.status).toBe(200);
    expect(previewRes.body).toEqual({ kind: 'preview' });
    expect(mockPreview).toHaveBeenCalledWith('v1', PLACE);
    expect(applyRes.status).toBe(200);
    expect(applyRes.body).toEqual({ kind: 'apply' });
    expect(mockApply).toHaveBeenCalledWith('v1', PLACE, 'google');
  });

  it('既有 GET /venues/admin/:id 與 GET /venues/:id 行為不變', async () => {
    mockGetAdminVenueById.mockResolvedValue({ id: 'v1', scope: 'admin' });
    mockGetVenueById.mockResolvedValue({ id: 'v1', scope: 'public' });

    const adminRes = await request(app)
      .get('/api/venues/admin/v1')
      .set('Authorization', 'Bearer admin-token');
    const publicRes = await request(app).get('/api/venues/v1');

    expect(adminRes.body).toEqual({ id: 'v1', scope: 'admin' });
    expect(publicRes.body).toEqual({ id: 'v1', scope: 'public' });
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });
});
