import request from 'supertest';

const mockUpdateArtistStatus = jest.fn();
const mockUpdateEventStatus = jest.fn();
const mockBatchArtists = jest.fn();
const mockBatchEvents = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn(() => Promise.resolve({ uid: 'admin-uid', email: 'a@x.com' })) },
  db: {
    collection: () => ({
      doc: () => ({ get: () => Promise.resolve({ data: () => ({ role: 'admin' }) }) }),
    }),
  },
}));

jest.mock('../../src/services/artistService', () => ({
  ArtistService: jest.fn().mockImplementation(() => ({
    updateArtistStatus: (...args: unknown[]) => mockUpdateArtistStatus(...args),
    batchUpdateArtistStatus: (...args: unknown[]) => mockBatchArtists(...args),
  })),
}));

jest.mock('../../src/services/eventService', () => ({
  EventService: jest.fn().mockImplementation(() => ({
    updateEventStatus: (...args: unknown[]) => mockUpdateEventStatus(...args),
    batchUpdateEventStatus: (...args: unknown[]) => mockBatchEvents(...args),
  })),
}));

import app from '../../src/app';

const REQUIRED = { error: '拒絕原因為必填', code: 'VALIDATION_ERROR' };
const VALID_ID = 'aBcD12345XyZ67890abc';

type Method = 'patch' | 'put' | 'post';

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateArtistStatus.mockResolvedValue({ id: 'a1' });
  mockUpdateEventStatus.mockResolvedValue({ id: 'e1' });
  mockBatchArtists.mockResolvedValue([]);
  mockBatchEvents.mockResolvedValue([]);
});

describe('review endpoints reject a missing rejection reason before reaching the service', () => {
  it.each<[Method, string, object, string]>([
    ['patch', '/api/artists/a1/review', { status: 'rejected' }, 'reason'],
    ['put', '/api/artists/a1/reject', {}, 'reason'],
    ['patch', '/api/events/e1/review', { status: 'rejected', reason: '  ' }, 'reason'],
    ['put', '/api/events/e1/reject', { reason: '' }, 'reason'],
    [
      'post',
      '/api/artists/batch-review',
      { updates: [{ artistId: VALID_ID, status: 'rejected' }] },
      'updates.0.reason',
    ],
    [
      'post',
      '/api/events/batch-review',
      { updates: [{ eventId: VALID_ID, status: 'rejected' }] },
      'updates.0.reason',
    ],
  ])('%s %s -> 400, nothing written', async (method, path, body, field) => {
    const res = await request(app)[method](path).set('Authorization', 'Bearer t').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ...REQUIRED, field });
    expect(mockUpdateArtistStatus).not.toHaveBeenCalled();
    expect(mockUpdateEventStatus).not.toHaveBeenCalled();
    expect(mockBatchArtists).not.toHaveBeenCalled();
    expect(mockBatchEvents).not.toHaveBeenCalled();
  });

  it('PUT /artists/:id/reject with a reason reaches the service with the trimmed reason', async () => {
    const res = await request(app)
      .put('/api/artists/a1/reject')
      .set('Authorization', 'Bearer t')
      .send({ reason: ' 照片不清楚 ' });

    expect(res.status).toBe(200);
    expect(mockUpdateArtistStatus).toHaveBeenCalledWith('a1', 'rejected', '照片不清楚');
  });

  it('PATCH /artists/:id/review keeps adminUpdate.groupNames when it reaches the service', async () => {
    const res = await request(app)
      .patch('/api/artists/a1/review')
      .set('Authorization', 'Bearer t')
      .send({ status: 'approved', adminUpdate: { groupNames: ['aespa'] } });

    expect(res.status).toBe(200);
    expect(mockUpdateArtistStatus).toHaveBeenCalledWith('a1', 'approved', undefined, {
      groupNames: ['aespa'],
    });
  });
});
