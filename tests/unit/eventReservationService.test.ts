import { EventService } from '../../src/services/eventService';
import { CreateEventData, UpdateEventData } from '../../src/models/types';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// req.body 在 controller 是 any，這裡的 _seconds/_nanoseconds 寫法比照實際 request payload（非 Date/string）
function asCreateEventData(data: unknown): CreateEventData {
  return data as CreateEventData;
}
function asUpdateEventData(data: unknown): UpdateEventData {
  return data as UpdateEventData;
}

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  withTimeoutAndRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  db: {
    collection: jest.fn(),
  },
}));

const mockArtistGet = jest.fn();
const mockEventSet = jest.fn();
const mockEventGet = jest.fn();
const mockEventUpdate = jest.fn();

const approvedArtistDoc = {
  exists: true,
  data: () => ({ status: 'approved', stageName: 'Test Artist', slug: 'test-artist' }),
};

function setupCollections() {
  const firebase = jest.requireMock('../../src/config/firebase');
  (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'artists') {
      return { doc: jest.fn(() => ({ get: mockArtistGet })) };
    }
    // coffeeEvents collection
    return {
      doc: jest.fn(() => ({
        id: 'event-1',
        set: mockEventSet,
        get: mockEventGet,
        update: mockEventUpdate,
      })),
    };
  });
  (firebase.withTimeoutAndRetry as jest.Mock).mockImplementation((fn: () => unknown) => fn());
}

describe('EventService.createEvent reservation handling', () => {
  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    setupCollections();
    mockArtistGet.mockResolvedValue(approvedArtistDoc);
    mockEventSet.mockResolvedValue(undefined);
    service = new EventService();
  });

  const baseCreateData = {
    artistIds: ['artist-1'],
    title: '測試活動',
    description: '',
    location: {
      name: '測試地點',
      address: '',
      coordinates: { lat: 25.03, lng: 121.56 },
    },
    datetime: {
      start: { _seconds: 1700000000, _nanoseconds: 0 },
      end: { _seconds: 1700003600, _nanoseconds: 0 },
    },
    socialMedia: { instagram: 'foo' },
  };

  it('reservation 未提供 → 不寫入 reservation 欄位', async () => {
    const result = await service.createEvent(
      asCreateEventData(baseCreateData),
      'user-1',
      'user@test.com'
    );
    expect(result.reservation).toBeUndefined();
    const savedDoc = mockEventSet.mock.calls[0][0];
    expect(savedDoc).not.toHaveProperty('reservation');
  });

  it('reservation 只有 url → 只寫入 url，不含 startAt key', async () => {
    const result = await service.createEvent(
      asCreateEventData({ ...baseCreateData, reservation: { url: 'https://example.com/reserve' } }),
      'user-1',
      'user@test.com'
    );
    expect(result.reservation).toEqual({ url: 'https://example.com/reserve' });
    const savedDoc = mockEventSet.mock.calls[0][0];
    expect(savedDoc.reservation).toEqual({ url: 'https://example.com/reserve' });
    expect(savedDoc.reservation).not.toHaveProperty('startAt');
  });

  it('reservation 有 url 與 startAt → 都寫入，startAt 轉為 Timestamp', async () => {
    const result = await service.createEvent(
      asCreateEventData({
        ...baseCreateData,
        reservation: {
          url: 'https://example.com/reserve',
          startAt: { _seconds: 1699999999, _nanoseconds: 0 },
        },
      }),
      'user-1',
      'user@test.com'
    );
    const savedDoc = mockEventSet.mock.calls[0][0];
    expect(savedDoc.reservation.url).toBe('https://example.com/reserve');
    expect(savedDoc.reservation.startAt).toBeInstanceOf(Timestamp);
    expect(savedDoc.reservation.startAt.seconds).toBe(1699999999);
    expect(result.reservation?.url).toBe('https://example.com/reserve');
  });
});

describe('EventService.updateEvent reservation handling', () => {
  let service: EventService;

  const existingEventData = {
    createdBy: 'user-1',
    slug: 'existing-slug',
    artists: [],
    verifiedOrganizers: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setupCollections();
    service = new EventService();
  });

  it('reservation 省略（undefined）→ updates 不含 reservation key，舊值不變', async () => {
    mockEventGet
      .mockResolvedValueOnce({ exists: true, data: () => existingEventData })
      .mockResolvedValueOnce({ id: 'event-1', data: () => existingEventData });
    mockEventUpdate.mockResolvedValue(undefined);

    await service.updateEvent('event-1', asUpdateEventData({ title: '新標題' }), 'user-1', 'user');

    const updates = mockEventUpdate.mock.calls[0][0];
    expect(updates).not.toHaveProperty('reservation');
  });

  it('reservation: null → updates.reservation 為 FieldValue.delete()', async () => {
    mockEventGet
      .mockResolvedValueOnce({ exists: true, data: () => existingEventData })
      .mockResolvedValueOnce({ id: 'event-1', data: () => existingEventData });
    mockEventUpdate.mockResolvedValue(undefined);

    await service.updateEvent(
      'event-1',
      asUpdateEventData({ reservation: null }),
      'user-1',
      'user'
    );

    const updates = mockEventUpdate.mock.calls[0][0];
    expect(updates.reservation).toEqual(FieldValue.delete());
  });

  it('reservation: {} (兩子欄位皆空) → updates.reservation 為 FieldValue.delete()', async () => {
    mockEventGet
      .mockResolvedValueOnce({ exists: true, data: () => existingEventData })
      .mockResolvedValueOnce({ id: 'event-1', data: () => existingEventData });
    mockEventUpdate.mockResolvedValue(undefined);

    await service.updateEvent('event-1', asUpdateEventData({ reservation: {} }), 'user-1', 'user');

    const updates = mockEventUpdate.mock.calls[0][0];
    expect(updates.reservation).toEqual(FieldValue.delete());
  });

  it('reservation 只有 url → updates.reservation 只含 url', async () => {
    mockEventGet
      .mockResolvedValueOnce({ exists: true, data: () => existingEventData })
      .mockResolvedValueOnce({ id: 'event-1', data: () => existingEventData });
    mockEventUpdate.mockResolvedValue(undefined);

    await service.updateEvent(
      'event-1',
      asUpdateEventData({ reservation: { url: 'https://example.com/reserve' } }),
      'user-1',
      'user'
    );

    const updates = mockEventUpdate.mock.calls[0][0];
    expect(updates.reservation).toEqual({ url: 'https://example.com/reserve' });
  });

  it('reservation 有 url 與 startAt → updates.reservation 含轉換後的 Timestamp', async () => {
    mockEventGet
      .mockResolvedValueOnce({ exists: true, data: () => existingEventData })
      .mockResolvedValueOnce({ id: 'event-1', data: () => existingEventData });
    mockEventUpdate.mockResolvedValue(undefined);

    await service.updateEvent(
      'event-1',
      asUpdateEventData({
        reservation: {
          url: 'https://example.com/reserve',
          startAt: { _seconds: 1699999999, _nanoseconds: 0 },
        },
      }),
      'user-1',
      'user'
    );

    const updates = mockEventUpdate.mock.calls[0][0];
    expect(updates.reservation.url).toBe('https://example.com/reserve');
    expect(updates.reservation.startAt).toBeInstanceOf(Timestamp);
    expect(updates.reservation.startAt.seconds).toBe(1699999999);
  });
});
