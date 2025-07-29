// Firebase Admin SDK Mock
const mockTimestamp = {
  now: jest.fn(() => ({
    toMillis: () => Date.now(),
    _seconds: Math.floor(Date.now() / 1000),
    _nanoseconds: 0,
  })),
  fromDate: jest.fn((date: Date) => ({
    toMillis: () => date.getTime(),
    _seconds: Math.floor(date.getTime() / 1000),
    _nanoseconds: 0,
  })),
};

const mockDoc = {
  id: 'mock-doc-id',
  exists: true,
  data: jest.fn(() => ({
    stageName: 'Test Artist',
    status: 'approved',
    createdAt: mockTimestamp.now(),
    updatedAt: mockTimestamp.now(),
  })),
  get: jest.fn(),
};

const mockSnapshot = {
  docs: [mockDoc],
  empty: false,
  size: 1,
};

// 建立一個完整的 mock document reference
const createMockDocRef = () => ({
  get: jest.fn().mockResolvedValue(mockDoc),
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
});

const mockCollection = {
  doc: jest.fn(() => createMockDocRef()),
  add: jest.fn().mockResolvedValue({ id: 'new-doc-id' }),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue(mockSnapshot),
};

const mockFirestore = {
  collection: jest.fn(() => mockCollection),
};

const mockAuth = {
  verifyIdToken: jest.fn().mockResolvedValue({
    uid: 'test-user-id',
    email: 'test@example.com',
  }),
};

const mockAdmin = {
  initializeApp: jest.fn(),
  firestore: jest.fn(() => mockFirestore),
  auth: jest.fn(() => mockAuth),
  credential: {
    cert: jest.fn(),
  },
  apps: { length: 0 },
};

// Mock firebase-admin
jest.mock('firebase-admin', () => mockAdmin);

// Mock firestore Timestamp
jest.mock('firebase-admin/firestore', () => ({
  Timestamp: mockTimestamp,
}));

export {
  mockAdmin,
  mockFirestore,
  mockAuth,
  mockCollection,
  mockDoc,
  mockSnapshot,
  mockTimestamp,
  createMockDocRef,
};
