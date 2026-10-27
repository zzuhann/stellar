import request from 'supertest';
import type { Express } from 'express';

jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureException: jest.fn(),
}));

// Submission routes only mount when Firebase is configured; Places itself never touches it
jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  auth: { verifyIdToken: jest.fn() },
  db: { collection: jest.fn(), getAll: jest.fn() },
}));

describe('TC-138 GET /api/venue-submissions/places/:placeId 回傳 types', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  let app: Express;
  let mockFetch: jest.Mock;

  beforeAll(async () => {
    // The controller reads the key when routes are constructed
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    app = (await import('../../src/app')).default;
  });

  afterAll(() => {
    process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const googleReplies = (body: Record<string, unknown>) => {
    mockFetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;
  };

  const place = {
    location: { latitude: 25.05, longitude: 121.52 },
    formattedAddress: '104台灣台北市中山區測試路1號',
    displayName: { text: '測試咖啡' },
    addressComponents: [{ longText: '台北市', types: ['administrative_area_level_1'] }],
  };

  it('FieldMask 包含 types；Google 回 types 原樣帶出；既有欄位不變', async () => {
    googleReplies({ ...place, types: ['cafe', 'establishment'] });

    const res = await request(app).get('/api/venue-submissions/places/ChIJabcdefghijk');

    expect(res.status).toBe(200);
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask'].split(',')).toEqual(
      expect.arrayContaining(['types', 'location', 'formattedAddress', 'displayName'])
    );
    expect(res.body).toEqual({
      geometry: { location: { lat: 25.05, lng: 121.52 } },
      formatted_address: '104台灣台北市中山區測試路1號',
      name: '測試咖啡',
      city: '台北市',
      types: ['cafe', 'establishment'],
    });
  });

  it('Google 沒回 types → types: []，請求不失敗', async () => {
    googleReplies(place);

    const res = await request(app).get('/api/venue-submissions/places/ChIJabcdefghijk');

    expect(res.status).toBe(200);
    expect(res.body.types).toEqual([]);
    expect(res.body.name).toBe('測試咖啡');
  });
});
