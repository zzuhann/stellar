import request from 'supertest';

// In-memory venues store shared by the mocked Firestore below
const mockStore: Record<string, Record<string, unknown>> = {};

jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

jest.mock('../../src/services/emailService', () => ({
  ...jest.requireActual('../../src/services/emailService'),
  sendVenueSubmissionNotification: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/config/firebase', () => {
  const { FieldValue } = jest.requireActual('firebase-admin/firestore');
  const fakeTimestamp = () => {
    const ms = Date.now();
    return { toMillis: () => ms, toDate: () => new Date(ms), _seconds: Math.floor(ms / 1000) };
  };
  // serverTimestamp() sentinels become a fake Timestamp, like Firestore would
  const resolve = (value: unknown) => (value instanceof FieldValue ? fakeTimestamp() : value);
  const resolveDeep = (obj: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k,
        v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof FieldValue)
          ? resolveDeep(v as Record<string, unknown>)
          : resolve(v),
      ])
    );

  const snapshot = (id: string) => ({
    id,
    exists: Boolean(mockStore[id]),
    data: () => mockStore[id],
  });

  const venueDoc = (id: string) => ({
    id,
    get: () => Promise.resolve(snapshot(id)),
    set: (data: Record<string, unknown>) => {
      mockStore[id] = resolveDeep(data);
      return Promise.resolve();
    },
    update: (data: Record<string, unknown>) => {
      if (!mockStore[id]) return Promise.reject(new Error('No document to update'));
      for (const [path, value] of Object.entries(data)) {
        const keys = path.split('.');
        let target = mockStore[id] as Record<string, unknown>;
        for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
        target[keys[keys.length - 1]] = resolve(value);
      }
      return Promise.resolve();
    },
  });

  return {
    hasFirebaseConfig: true,
    auth: {
      verifyIdToken: (token: string) =>
        token === 'admin-token'
          ? Promise.resolve({ uid: 'admin-uid', email: 'a@x.com' })
          : Promise.reject(new Error('bad token')),
    },
    db: {
      collection: (name: string) => {
        if (name === 'users') {
          return {
            doc: () => ({ get: () => Promise.resolve({ data: () => ({ role: 'admin' }) }) }),
          };
        }
        if (name === 'venueViewDaily') {
          return { where: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
        }
        return {
          doc: (id?: string) => venueDoc(id ?? 'flow-venue'),
          orderBy: () => ({
            get: () => Promise.resolve({ docs: Object.keys(mockStore).map(id => snapshot(id)) }),
          }),
        };
      },
      getAll: () => Promise.resolve([]),
    },
  };
});

import app from '../../src/app';

const admin = { Authorization: 'Bearer admin-token' };

const venueConditions = {
  uses: { options: ['goods_distribution', 'can_decorate'] },
  fees: { venueFee: 'free' },
  services: { options: ['parcel_receiving'] },
  spaceTypes: { options: ['cafe'] },
  sourceLinks: ['https://a.com/doc'],
  note: '可租扭蛋機',
};

describe('TC-092 投稿 → 上架 → 確認的完整流程', () => {
  it('建議要確認後才上公開 API；聯絡欄位不用等確認；確認後 submission 原樣保留', async () => {
    // (1) 店家投稿
    const submit = await request(app)
      .post('/api/venue-submissions')
      .send({
        name: '測試場地',
        address: '台北市測試路 1 號',
        region: '台北',
        capacityRange: '20-40',
        coverPhoto: 'https://example.com/cover.jpg',
        preferredContact: 'instagram',
        socialMedia: { instagram: 'venue' },
        bookingFormUrl: 'https://forms.gle/x',
        venueConditions,
      });
    expect(submit.status).toBe(201);
    const id = submit.body.id as string;

    // (2) 批次審核上架
    const review = await request(app)
      .patch('/api/venues/batch-review')
      .set(admin)
      .send({ updates: [{ venueId: id, status: 'active' }] });
    expect(review.status).toBe(200);
    expect(review.body.processed).toBe(1);

    // (3) 公開了，但建議還沒生效
    const detail = await request(app).get(`/api/venues/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      tags: [],
      sourceLinks: [],
      equipmentNote: '',
      infoUpdatedOn: null,
      bookingFormUrl: 'https://forms.gle/x',
    });
    expect(detail.body).not.toHaveProperty('submission');
    expect(detail.body).not.toHaveProperty('calendarUrl');

    const list = await request(app).get('/api/venues');
    const listed = list.body.venues.find((v: { id: string }) => v.id === id);
    expect(listed.tags).toEqual([]);
    expect(listed).not.toHaveProperty('bookingFormUrl');
    expect(listed).not.toHaveProperty('submission');

    // (4) 管理員確認：拿掉 free_venue、加 deposit
    const adopted = [{ slug: 'goods_distribution' }, { slug: 'can_decorate' }, { slug: 'deposit' }];
    const patch = await request(app)
      .patch(`/api/venues/${id}`)
      .set(admin)
      .send({
        confirmSuggestions: true,
        tags: adopted,
        sourceLinks: ['https://a.com/doc'],
        equipmentNote: '扭蛋機',
        infoUpdatedOn: '2026-10-15',
      });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ message: 'Venue updated' });

    // (5) 公開 API 回傳採用的值
    const after = await request(app).get(`/api/venues/${id}`);
    expect(after.body.tags).toEqual(adopted);
    expect(after.body.sourceLinks).toEqual(['https://a.com/doc']);
    expect(after.body.equipmentNote).toBe('扭蛋機');
    expect(after.body).not.toHaveProperty('submission');

    const listAfter = await request(app).get('/api/venues');
    const listedAfter = listAfter.body.venues.find((v: { id: string }) => v.id === id);
    expect(listedAfter.tags).toEqual(adopted);

    const adminDetail = await request(app).get(`/api/venues/admin/${id}`).set(admin);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.submission.answers).toEqual(venueConditions);
    expect(adminDetail.body.submission.confirmedAt).not.toBeNull();
    expect(adminDetail.body.submission.suggestedTags).toEqual(
      expect.arrayContaining([{ slug: 'free_venue', source: 'store' }])
    );
    // confirmSuggestions 不會被當成欄位存進文件
    expect(mockStore[id]).not.toHaveProperty('confirmSuggestions');
  });
});
