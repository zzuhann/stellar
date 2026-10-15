import request from 'supertest';

const mockVerifyIdToken = jest.fn();
const mockVenueSet = jest.fn();
const mockVenueUpdate = jest.fn();
const mockVenueGet = jest.fn();

jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

jest.mock('../../src/services/emailService', () => ({
  ...jest.requireActual('../../src/services/emailService'),
  sendVenueSubmissionNotification: jest.fn(() => Promise.resolve()),
}));

// 用真的 route → controller → service，只 mock Firestore
jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: (token: string) => mockVerifyIdToken(token) },
  db: {
    collection: (name: string) => {
      if (name === 'users') {
        return {
          doc: (uid: string) => ({
            get: () =>
              Promise.resolve({ data: () => ({ role: uid === 'admin-uid' ? 'admin' : 'user' }) }),
          }),
        };
      }
      return {
        doc: (id?: string) => ({
          id: id ?? 'new-venue-id',
          set: (...args: unknown[]) => mockVenueSet(...args),
          update: (...args: unknown[]) => mockVenueUpdate(...args),
          get: () => mockVenueGet(),
        }),
      };
    },
    getAll: jest.fn(),
  },
}));

jest.mock('../../src/constants/venueTags', () => {
  const actual = jest.requireActual('../../src/constants/venueTags');
  return {
    ...actual,
    VENUE_TAGS: [
      ...actual.VENUE_TAGS,
      { slug: 'retired_tag', group: 'service', label: '停用', order: 99, active: false },
    ],
  };
});

import app from '../../src/app';

const venueBody = {
  name: '測試場地',
  address: '台北市測試路 1 號',
  region: '台北',
  capacityRange: '20-40',
  coverPhoto: 'https://example.com/cover.jpg',
  preferredContact: 'instagram',
  socialMedia: { instagram: 'venue' },
};

const TAG_FIELDS = ['tags', 'sourceLinks', 'equipmentNote', 'infoUpdatedOn', 'calendarUrl'];

beforeEach(() => {
  jest.clearAllMocks();
  mockVenueSet.mockResolvedValue(undefined);
  mockVenueUpdate.mockResolvedValue(undefined);
  mockVerifyIdToken.mockImplementation((token: string) => {
    if (token === 'admin-token') return Promise.resolve({ uid: 'admin-uid', email: 'a@x.com' });
    if (token === 'user-token') return Promise.resolve({ uid: 'user-uid', email: 'u@x.com' });
    return Promise.reject(new Error('bad token'));
  });
});

describe('POST /api/venue-submissions 權限邊界', () => {
  it('TC-080 匿名投稿帶正式標籤欄位：201，寫入的文件沒有這些值', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({
        ...venueBody,
        tags: [{ slug: 'free_venue' }],
        sourceLinks: ['https://a.com'],
        equipmentNote: '投影機',
        infoUpdatedOn: '2026-10-15',
        calendarUrl: 'https://calendar.example.com',
      });

    expect(res.status).toBe(201);
    const written = mockVenueSet.mock.calls[0][0];
    expect(written.tags).toEqual([]);
    expect(written.sourceLinks).toEqual([]);
    expect(written.equipmentNote).toBe('');
    expect(written.infoUpdatedOn).toBeNull();
    expect(written.calendarUrl).toBeNull();
    expect(written.status).toBe('pending');
    expect(written).not.toHaveProperty('submission');
    expect(res.body).not.toHaveProperty('calendarUrl');
    expect(res.body).not.toHaveProperty('submission');
  });

  it('TC-082 舊表單只送 hostTags：201，hostTags 照存，沒有 submission', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, hostTags: ['大空間'] });

    expect(res.status).toBe(201);
    const written = mockVenueSet.mock.calls[0][0];
    expect(written.hostTags).toEqual(['大空間']);
    expect(written).not.toHaveProperty('submission');
  });
});

describe('GET /api/venues/tag-dictionary', () => {
  it('TC-002 200（沒被 /:id 吃掉）、只回 active、不回 active 欄位、Cache-Control', async () => {
    const res = await request(app).get('/api/venues/tag-dictionary');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(mockVenueGet).not.toHaveBeenCalled();

    const slugs = (res.body.tags as { slug: string }[]).map(t => t.slug);
    expect(slugs).toContain('free_venue');
    expect(slugs).not.toContain('retired_tag');
    for (const tag of res.body.tags) expect(tag).not.toHaveProperty('active');

    expect(res.body.groups.map((g: { key: string }) => g.key)).toEqual([
      'price',
      'service',
      'transport',
      'space',
      'equipment',
    ]);
    const freeVenue = res.body.tags.find((t: { slug: string }) => t.slug === 'free_venue');
    expect(freeVenue).toEqual({
      slug: 'free_venue',
      group: 'price',
      label: '免場地費',
      order: 1,
      cardRank: 2,
    });
    const deposit = res.body.tags.find((t: { slug: string }) => t.slug === 'deposit');
    expect(deposit).not.toHaveProperty('cardRank');
  });
});

describe('admin 寫入場地的新欄位', () => {
  it('TC-004 POST /api/venues 帶 tags：201，文件寫入 tags、pending、沒有 submission；沒帶 infoUpdatedOn 存 null', async () => {
    const res = await request(app)
      .post('/api/venues')
      .set('Authorization', 'Bearer admin-token')
      .send({ ...venueBody, tags: [{ slug: 'free_venue', limited: true, until: '2026-12-31' }] });

    expect(res.status).toBe(201);
    const written = mockVenueSet.mock.calls[0][0];
    expect(written.tags).toEqual([{ slug: 'free_venue', limited: true, until: '2026-12-31' }]);
    expect(written.status).toBe('pending');
    expect(written.infoUpdatedOn).toBeNull();
    expect(written).not.toHaveProperty('submission');
  });

  it('PATCH /api/venues/:id 帶未知 slug → 400，不寫入', async () => {
    const res = await request(app)
      .patch('/api/venues/v1')
      .set('Authorization', 'Bearer admin-token')
      .send({ tags: [{ slug: 'retired_tag' }] });

    expect(res.status).toBe(400);
    expect(mockVenueUpdate).not.toHaveBeenCalled();
  });
});

describe('TC-084 admin 寫入與詳情端點的身分檢查', () => {
  it.each([
    ['POST /api/venues', () => request(app).post('/api/venues')],
    ['PATCH /api/venues/:id', () => request(app).patch('/api/venues/v1')],
    ['GET /api/venues/admin/:id', () => request(app).get('/api/venues/admin/v1')],
  ])('%s：無 token 401、一般使用者 403，Firestore 沒有讀寫', async (_name, makeReq) => {
    const body = { ...venueBody, tags: [{ slug: 'free_venue' }] };

    const anon = await makeReq().send(body);
    expect(anon.status).toBe(401);

    const user = await makeReq().set('Authorization', 'Bearer user-token').send(body);
    expect(user.status).toBe(403);

    expect(mockVenueSet).not.toHaveBeenCalled();
    expect(mockVenueUpdate).not.toHaveBeenCalled();
    expect(mockVenueGet).not.toHaveBeenCalled();
  });
});

// 防止未來 refactor 讓投稿路徑又跟 admin 共用 schema
it('TC-080 補充：投稿 schema 與 admin schema 的差異只在五個正式欄位', async () => {
  const { venueSchemas } = await import('../../src/middleware/validation');
  const adminKeys = Object.keys(venueSchemas.create.shape);
  const submissionKeys = Object.keys(venueSchemas.createSubmission.shape);
  expect(adminKeys.filter(k => !submissionKeys.includes(k)).sort()).toEqual([...TAG_FIELDS].sort());
});
