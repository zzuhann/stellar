import { VenueService } from '../../src/services/venueService';

const mockDelete = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDocRef = { get: mockGet, delete: mockDelete, update: mockUpdate };

const mockCollectionGet = jest.fn();
const mockWhere = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  withTimeoutAndRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  db: {
    collection: jest.fn(),
    getAll: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

describe('VenueService.permanentDeleteVenue', () => {
  let service: VenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    (firebase.withTimeoutAndRetry as jest.Mock).mockImplementation((fn: () => unknown) => fn());
    service = new VenueService();
  });

  it('場地不存在 → not_found', async () => {
    mockGet.mockResolvedValue({ exists: false });
    await expect(service.permanentDeleteVenue('venue-123')).resolves.toBe('not_found');
  });

  it('有關聯活動 → has_events，不呼叫 Firestore delete', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ eventRefs: [{ id: 'event-1' }] }),
    });
    await expect(service.permanentDeleteVenue('venue-123')).resolves.toBe('has_events');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('無關聯活動 → deleted，呼叫 Firestore delete', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ eventRefs: [] }),
    });
    mockDelete.mockResolvedValue(undefined);
    await expect(service.permanentDeleteVenue('venue-123')).resolves.toBe('deleted');
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('VenueService.batchReview', () => {
  let service: VenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'coffeeEvents') {
        return {
          where: mockWhere,
          doc: jest.fn(() => mockDocRef),
        };
      }
      return {
        doc: jest.fn(() => mockDocRef),
        where: mockWhere,
      };
    });
    mockWhere.mockReturnValue({ get: mockCollectionGet });
    (firebase.withTimeoutAndRetry as jest.Mock).mockImplementation((fn: () => unknown) => fn());
    (firebase.db.runTransaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = { get: jest.fn(), update: jest.fn() };
        await fn(tx);
      }
    );
    service = new VenueService();
  });

  it('非 pending 的場地跳過，processed = 0', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', placeId: 'place-1' }),
    });

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('場地不存在跳過，processed = 0', async () => {
    mockGet.mockResolvedValue({ exists: false });

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('pending → rejected，不觸發 onVenueApproved，processed = 1', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', placeId: 'place-1' }),
    });
    mockUpdate.mockResolvedValue(undefined);
    // onVenueApproved should NOT be triggered; mockCollectionGet should not be called
    mockCollectionGet.mockResolvedValue({ docs: [] });

    const result = await service.batchReview([{ venueId: 'v1', status: 'rejected' }]);
    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  it('pending → active，觸發 onVenueApproved，processed = 1', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', placeId: 'place-1' }),
    });
    mockUpdate.mockResolvedValue(undefined);
    // onVenueApproved queries coffeeEvents
    mockCollectionGet.mockResolvedValue({ docs: [] });

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockCollectionGet).toHaveBeenCalledTimes(1);
  });

  it('pending → active 但 placeId 為空，不呼叫 coffeeEvents 查詢', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', placeId: '' }),
    });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchReview([{ venueId: 'v1', status: 'active' }]);
    expect(result).toBe(1);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  it('混合更新：2 pending + 1 active → processed = 2', async () => {
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pending', placeId: '' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'active', placeId: 'place-2' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pending', placeId: '' }),
      });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchReview([
      { venueId: 'v1', status: 'active' },
      { venueId: 'v2', status: 'active' }, // status is active, should be skipped
      { venueId: 'v3', status: 'rejected' },
    ]);
    expect(result).toBe(2);
  });
});

describe('VenueService.batchStatus', () => {
  let service: VenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    (firebase.withTimeoutAndRetry as jest.Mock).mockImplementation((fn: () => unknown) => fn());
    service = new VenueService();
  });

  it('場地不存在跳過，processed = 0', async () => {
    mockGet.mockResolvedValue({ exists: false });

    const result = await service.batchStatus([{ venueId: 'v1', status: 'inactive' }]);
    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('場地存在 → 更新 status，processed = 1', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active' }),
    });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchStatus([{ venueId: 'v1', status: 'inactive' }]);
    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('多筆更新，全部存在 → processed = 3', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active' }),
    });
    mockUpdate.mockResolvedValue(undefined);

    const result = await service.batchStatus([
      { venueId: 'v1', status: 'inactive' },
      { venueId: 'v2', status: 'active' },
      { venueId: 'v3', status: 'inactive' },
    ]);
    expect(result).toBe(3);
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });
});
