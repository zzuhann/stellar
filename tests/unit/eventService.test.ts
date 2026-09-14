import { EventService } from '../../src/services/eventService';
import { UpdateEventData, CreateEventData } from '../../src/models/types';

const mockGet = jest.fn();
const mockDocRef = {
  get: mockGet,
};

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

describe('EventService.resubmitEvent', () => {
  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new EventService();
  });

  it('活動狀態不是 rejected 時，丟出 409 EVENT_RESUBMIT_INVALID_STATE', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ createdBy: 'user-1', status: 'approved' }),
    });

    await expect(service.resubmitEvent('event-1', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'EVENT_RESUBMIT_INVALID_STATE',
    });
  });

  it.each(['pending', 'approved'])(
    '活動狀態為 %s（非 rejected）時同樣丟出 409 EVENT_RESUBMIT_INVALID_STATE',
    async status => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ createdBy: 'user-1', status }),
      });

      await expect(service.resubmitEvent('event-1', 'user-1')).rejects.toMatchObject({
        statusCode: 409,
        code: 'EVENT_RESUBMIT_INVALID_STATE',
      });
    }
  );
});

describe('EventService.updateEvent — 座標驗證', () => {
  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ createdBy: 'other-user', status: 'approved', verifiedOrganizers: [] }),
    });
    service = new EventService();
  });

  it('座標完全缺失時，丟出 400 VALIDATION_ERROR，field 精確為 location.coordinates', async () => {
    const updateData = {
      location: { name: '測試場地', address: '台北市測試路 1 號', coordinates: {} },
    } as unknown as UpdateEventData;

    await expect(
      service.updateEvent('event-1', updateData, 'admin-uid', 'admin')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      field: 'location.coordinates',
    });
  });

  it('只有 lng 缺失（lat 存在）時，同樣丟出 field 為 location.coordinates 的 400 VALIDATION_ERROR', async () => {
    const updateData = {
      location: {
        name: '測試場地',
        address: '台北市測試路 1 號',
        coordinates: { lat: 25.03 },
      },
    } as unknown as UpdateEventData;

    await expect(
      service.updateEvent('event-1', updateData, 'admin-uid', 'admin')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      field: 'location.coordinates',
    });
  });
});

describe('EventService.createEvent — 座標驗證', () => {
  let service: EventService;
  const mockArtistDocRef = { get: jest.fn() };
  const mockEventDocRef = { id: 'event-new', set: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'artists') {
        return { doc: jest.fn(() => mockArtistDocRef) };
      }
      // coffeeEvents collection：createEvent 用 collection.doc() 產生新 doc ref
      return { doc: jest.fn(() => mockEventDocRef) };
    });
    mockArtistDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'approved', stageName: '測試藝人', slug: 'test-artist' }),
    });
    service = new EventService();
  });

  it('藝人驗證通過但座標缺失時，丟出 400 VALIDATION_ERROR，field 精確為 location.coordinates', async () => {
    const eventData = {
      artistIds: ['artist-1'],
      title: '測試活動',
      description: '測試描述',
      location: {
        name: '測試場地',
        address: '台北市測試路 1 號',
        coordinates: {},
      },
      datetime: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-01T06:00:00.000Z' },
      socialMedia: {},
    } as unknown as CreateEventData;

    await expect(
      service.createEvent(eventData, 'user-1', 'user@example.com')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      field: 'location.coordinates',
    });
  });
});
