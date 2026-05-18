import { VenueService } from '../../src/services/venueService';

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  withTimeoutAndRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  db: {
    collection: jest.fn(),
  },
}));

describe('VenueService.permanentDeleteVenue', () => {
  let service: VenueService;
  const mockDelete = jest.fn();
  const mockGet = jest.fn();
  const mockDocRef = { get: mockGet, delete: mockDelete };

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
