import { UserService } from '../../src/services/userService';

const mockFavoritesGet = jest.fn();
const mockEventDocGet = jest.fn();

const mockFavoritesWhere = jest.fn();
const mockFavoritesLimit = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

describe('UserService.isFavorited', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();

    // userFavorites collection: .where().where().limit().get()
    mockFavoritesLimit.mockReturnValue({ get: mockFavoritesGet });
    mockFavoritesWhere.mockReturnValue({
      where: jest.fn(() => ({ limit: mockFavoritesLimit })),
    });

    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'userFavorites') {
        return { where: mockFavoritesWhere };
      }
      if (name === 'coffeeEvents') {
        return { doc: jest.fn(() => ({ get: mockEventDocGet })) };
      }
      return {};
    });

    service = new UserService();
  });

  it('userFavorites 文件不存在 → false', async () => {
    mockFavoritesGet.mockResolvedValue({ empty: true });

    await expect(service.isFavorited('user-1', 'event-1')).resolves.toBe(false);
    expect(mockEventDocGet).not.toHaveBeenCalled();
  });

  it('userFavorites 存在但對應活動已被刪除 → false', async () => {
    mockFavoritesGet.mockResolvedValue({ empty: false });
    mockEventDocGet.mockResolvedValue({ exists: false });

    await expect(service.isFavorited('user-1', 'event-1')).resolves.toBe(false);
  });

  it('userFavorites 存在但活動狀態為 pending → false', async () => {
    mockFavoritesGet.mockResolvedValue({ empty: false });
    mockEventDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending' }),
    });

    await expect(service.isFavorited('user-1', 'event-1')).resolves.toBe(false);
  });

  it('userFavorites 存在但活動狀態為 rejected → false', async () => {
    mockFavoritesGet.mockResolvedValue({ empty: false });
    mockEventDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'rejected' }),
    });

    await expect(service.isFavorited('user-1', 'event-1')).resolves.toBe(false);
  });

  it('userFavorites 存在且活動狀態為 approved → true', async () => {
    mockFavoritesGet.mockResolvedValue({ empty: false });
    mockEventDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'approved' }),
    });

    await expect(service.isFavorited('user-1', 'event-1')).resolves.toBe(true);
  });
});
