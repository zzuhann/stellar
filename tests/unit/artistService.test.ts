import { ArtistService } from '../../src/services/artistService';
import { AppError } from '../../src/utils/AppError';

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

describe('ArtistService.resubmitArtist', () => {
  let service: ArtistService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new ArtistService();
  });

  it('藝人狀態不是 rejected 時，丟出 409 ARTIST_RESUBMIT_INVALID_STATE', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ createdBy: 'user-1', status: 'approved' }),
    });

    await expect(service.resubmitArtist('artist-1', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ARTIST_RESUBMIT_INVALID_STATE',
    });
  });

  it.each(['pending', 'approved'])(
    '藝人狀態為 %s（非 rejected）時同樣丟出 409 ARTIST_RESUBMIT_INVALID_STATE',
    async status => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ createdBy: 'user-1', status }),
      });

      await expect(service.resubmitArtist('artist-1', 'user-1')).rejects.toThrow(AppError);
    }
  );

  it('藝人狀態為 rejected 時，不丟出 ARTIST_RESUBMIT_INVALID_STATE（正常重新送審）', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ createdBy: 'user-1', status: 'rejected', stageName: '測試藝人' }),
    });
    (mockDocRef as unknown as { update: jest.Mock }).update = jest
      .fn()
      .mockResolvedValue(undefined);

    const result = await service.resubmitArtist('artist-1', 'user-1');
    expect(result.id).toBe('artist-1');
  });
});

describe('ArtistService.deleteArtist', () => {
  let service: ArtistService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new ArtistService();
  });

  it('藝人仍有關聯生咖活動（activeEventIds 非空）時，丟出 409 ARTIST_HAS_EVENTS', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeEventIds: ['event-1'] }),
    });

    await expect(service.deleteArtist('artist-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ARTIST_HAS_EVENTS',
    });
  });

  it('藝人沒有關聯生咖活動時，正常刪除，不丟出 ARTIST_HAS_EVENTS', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeEventIds: [] }),
    });
    (mockDocRef as unknown as { delete: jest.Mock }).delete = jest
      .fn()
      .mockResolvedValue(undefined);

    await expect(service.deleteArtist('artist-1')).resolves.toBeUndefined();
  });
});

describe('ArtistService.updateArtistStatus', () => {
  let service: ArtistService;

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({
      doc: jest.fn(() => mockDocRef),
    });
    service = new ArtistService();
  });

  it('artistId 不存在時，丟出 404 ARTIST_NOT_FOUND，且不呼叫 docRef.update()', async () => {
    mockGet.mockResolvedValue({ exists: false });
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    (mockDocRef as unknown as { update: jest.Mock }).update = mockUpdate;

    await expect(service.updateArtistStatus('artist-missing', 'approved')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ARTIST_NOT_FOUND',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('ArtistService.batchUpdateArtistStatus', () => {
  let service: ArtistService;
  const mockBatchDoc = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockReturnValue({ doc: mockBatchDoc });
    service = new ArtistService();
  });

  it('批次更新中包含不存在的 artistId 時，丟出 404 ARTIST_NOT_FOUND', async () => {
    const existingDocRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        id: 'artist-1',
        data: () => ({ status: 'pending', stageName: '存在的藝人' }),
      }),
    };
    const missingDocRef = {
      get: jest.fn().mockResolvedValue({ exists: false, id: 'artist-missing' }),
    };

    mockBatchDoc.mockImplementation((id: string) =>
      id === 'artist-missing' ? missingDocRef : existingDocRef
    );

    await expect(
      service.batchUpdateArtistStatus([
        { artistId: 'artist-1', status: 'approved' },
        { artistId: 'artist-missing', status: 'approved' },
      ])
    ).rejects.toMatchObject({ statusCode: 404, code: 'ARTIST_NOT_FOUND' });
  });
});
