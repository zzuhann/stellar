import { UserService } from '../../src/services/userService';

const mockGetUser = jest.fn();
let mockAuth: { getUser: jest.Mock } | null = null;

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  get auth() {
    return mockAuth;
  },
  db: { collection: jest.fn(() => ({})) },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

describe('UserService.isAnonymousUser', () => {
  let service: UserService;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = { getUser: mockGetUser };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    service = new UserService();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([
    ['anonymous account (no providers)', { providerData: [] }, true],
    ['Google account', { providerData: [{ providerId: 'google.com' }] }, false],
    [
      'anonymous account later linked to Google',
      { providerData: [{ providerId: 'google.com' }] },
      false,
    ],
  ])('%s', async (_name, user, expected) => {
    mockGetUser.mockResolvedValue(user);

    await expect(service.isAnonymousUser('uid-1')).resolves.toBe(expected);
    expect(mockGetUser).toHaveBeenCalledWith('uid-1');
  });

  it.each([
    ['user was deleted', Object.assign(new Error('gone'), { code: 'auth/user-not-found' })],
    ['Auth is temporarily down', new Error('unavailable')],
  ])('%s -> treated as anonymous and logged', async (_name, error) => {
    mockGetUser.mockRejectedValue(error);

    await expect(service.isAnonymousUser('uid-1')).resolves.toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('empty uid -> anonymous without calling Auth', async () => {
    await expect(service.isAnonymousUser('')).resolves.toBe(true);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('auth not configured -> anonymous', async () => {
    mockAuth = null;

    await expect(service.isAnonymousUser('uid-1')).resolves.toBe(true);
  });
});
