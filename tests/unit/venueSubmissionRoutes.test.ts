import request from 'supertest';

const mockVenueSet = jest.fn();

jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

jest.mock('../../src/services/emailService', () => ({
  ...jest.requireActual('../../src/services/emailService'),
  sendVenueSubmissionNotification: jest.fn(() => Promise.resolve()),
}));

// Submission limiter is 5/hour; this file posts more than that
jest.mock('../../src/middleware/rateLimiters', () => {
  const actual = jest.requireActual('../../src/middleware/rateLimiters');
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return Object.fromEntries(Object.keys(actual).map(key => [key, passThrough]));
});

// 用真的 route → controller → service，只 mock Firestore 寫入
jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn() },
  db: {
    collection: () => ({
      doc: (id?: string) => ({
        id: id ?? 'new-venue-id',
        set: (...args: unknown[]) => mockVenueSet(...args),
      }),
    }),
    getAll: jest.fn(),
  },
}));

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

const venueConditions = {
  uses: { options: ['goods_distribution', 'can_decorate'] },
  fees: { venueFee: 'free', deposit: 'yes' },
  services: { options: ['parcel_receiving'] },
  spaceTypes: { options: ['cafe'] },
  note: '可租扭蛋機',
  sourceLinks: ['https://a.com/doc'],
  calendarUrl: 'https://calendar.example.com/a',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVenueSet.mockResolvedValue(undefined);
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-20T04:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('POST /api/venue-submissions 帶 venueConditions', () => {
  it('TC-081 只存成建議：tags 空、F/設備留空、submission 完整、calendarUrl 寫正式欄位、回應不含 submission', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, venueConditions, tags: [{ slug: 'private_booking' }] });

    expect(res.status).toBe(201);
    const written = mockVenueSet.mock.calls[0][0];
    expect(written.tags).toEqual([]);
    expect(written.sourceLinks).toEqual([]);
    expect(written.equipmentNote).toBe('');
    expect(written.calendarUrl).toBe('https://calendar.example.com/a');
    expect(written.status).toBe('pending');
    expect(written.submission).toMatchObject({
      answers: venueConditions,
      confirmedAt: null,
    });
    expect(written.submission.submittedAt).toBeDefined();
    expect(written.submission.suggestedTags.map((t: { slug: string }) => t.slug)).toEqual([
      'goods_distribution',
      'can_decorate',
      'free_venue',
      'deposit',
      'parcel_receiving',
      'cafe',
    ]);
    // 匿名帶的正式 tags 不會跑進建議或正式欄位
    expect(JSON.stringify(written)).not.toContain('private_booking');
    expect(res.body).not.toHaveProperty('submission');
    expect(res.body).not.toHaveProperty('calendarUrl');
  });

  it.each([
    ['A 沒有 options 也沒有 discussable', { ...venueConditions, uses: { options: [] } }],
    ['A 只帶舊的 other', { ...venueConditions, uses: { other: '拍貼機' } }],
    ['C 只帶舊的 other', { ...venueConditions, services: { other: '代訂花' } }],
    ['A 勾 can_decorate 但 B 什麼都沒有', { ...venueConditions, fees: undefined }],
    ['B 的值不在 enum', { ...venueConditions, fees: { venueFee: 'maybe' } }],
    ['note trim 後超過 1000 字', { ...venueConditions, note: 'a'.repeat(1001) }],
    ['沒帶 spaceTypes', { ...venueConditions, spaceTypes: undefined }],
    ['spaceTypes.options 空', { ...venueConditions, spaceTypes: { options: [] } }],
    ['沒帶 services', { ...venueConditions, services: undefined }],
    ['uses.options 不在 enum', { ...venueConditions, uses: { options: ['unknown'] } }],
    ['services.options 不在 enum', { ...venueConditions, services: { options: ['unknown'] } }],
    ['spaceTypes.options 不在 enum', { ...venueConditions, spaceTypes: { options: ['unknown'] } }],
    ['equipment 不在 enum', { ...venueConditions, equipment: ['unknown'] }],
    [
      'freeVenueUntil 早於台灣今天',
      { ...venueConditions, fees: { venueFee: 'free', freeVenueUntil: '2026-10-19' } },
    ],
  ])('TC-070 400（%s）：Firestore 沒有寫入、沒有 submission', async (_name, conditions) => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, venueConditions: conditions });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockVenueSet).not.toHaveBeenCalled();
  });

  it('TC-082 舊表單只送 hostTags（第 2 階段仍要通過）：201、hostTags 照存、沒有 submission、calendarUrl 為 null', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, hostTags: ['大空間'], nearestMrt: '中山', mrtWalkMinutes: 3 });

    expect(res.status).toBe(201);
    const written = mockVenueSet.mock.calls[0][0];
    expect(written.hostTags).toEqual(['大空間']);
    expect(written.nearestMrt).toBe('中山');
    expect(written.mrtWalkMinutes).toBe(3);
    expect(written.calendarUrl).toBeNull();
    expect(written).not.toHaveProperty('submission');
    expect(written).not.toHaveProperty('transitStops');
  });
});

describe('POST /api/venue-submissions 帶 transitStops（第 2 階段）', () => {
  it('TC-080 d 寫進正式欄位（照送的順序）、不在 submission；照類型優先序回寫舊欄位；pending', async () => {
    const transitStops = [
      { type: 'bus', station: '復興新和街口', walkMinutes: 3 },
      { type: 'mrt', station: '中山', walkMinutes: 5 },
    ];
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, transitStops, venueConditions, nearestMrt: '舊表單的值' });

    expect(res.status).toBe(201);
    const written = mockVenueSet.mock.calls[0][0];
    expect(written.transitStops).toEqual(transitStops);
    expect(written.nearestMrt).toBe('中山');
    expect(written.mrtWalkMinutes).toBe(5);
    expect(written.status).toBe('pending');
    expect(written.submission).not.toHaveProperty('transitStops');
    expect(written.submission.answers).not.toHaveProperty('transitStops');
    // 投稿當下的交通快照算出 auto 的 near_mrt
    expect(written.submission.suggestedTags).toContainEqual({ slug: 'near_mrt', source: 'auto' });
  });

  it('TC-080 d transitStops: [] → 存 []、nearestMrt: ""、mrtWalkMinutes: null', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, transitStops: [], nearestMrt: '中山', mrtWalkMinutes: 3 });

    expect(res.status).toBe(201);
    expect(mockVenueSet.mock.calls[0][0]).toMatchObject({
      transitStops: [],
      nearestMrt: '',
      mrtWalkMinutes: null,
    });
  });

  it('TC-072（route 層）沒帶 transitStops、payload 有 nearestMrt 3 分鐘 → 不產生 near_mrt（不退回讀舊欄位）', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, venueConditions, nearestMrt: '中山', mrtWalkMinutes: 3 });

    expect(res.status).toBe(201);
    const slugs = mockVenueSet.mock.calls[0][0].submission.suggestedTags.map(
      (t: { slug: string }) => t.slug
    );
    expect(slugs).not.toContain('near_mrt');
    expect(slugs).not.toContain('near_train');
  });

  it('TC-134 不合法的 transitStops → 400、不寫入', async () => {
    const res = await request(app)
      .post('/api/venue-submissions')
      .send({ ...venueBody, transitStops: [{ type: 'mrt' }] });
    expect(res.status).toBe(400);
    expect(mockVenueSet).not.toHaveBeenCalled();
  });
});
