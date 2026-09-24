import { Response } from 'express';
import { ArtistController } from '../../src/controllers/artistController';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { ArtistService } from '../../src/services/artistService';

// Mock 整個 ArtistService，避免碰 Firestore；建構子也不會執行真正的欄位初始化
jest.mock('../../src/services/artistService');

describe('ArtistController.getAllArtists - status 守門邏輯', () => {
  let controller: ArtistController;
  let mockGetArtistsWithFilters: jest.Mock;
  let res: Partial<Response>;

  const dummyResult: unknown[] = [];

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetArtistsWithFilters = jest.fn().mockResolvedValue(dummyResult);
    (ArtistService as jest.Mock).mockImplementation(() => ({
      getArtistsWithFilters: mockGetArtistsWithFilters,
    }));

    controller = new ArtistController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (
    query: Record<string, string>,
    user?: { uid: string; email: string; role: 'user' | 'admin' }
  ): AuthenticatedRequest => {
    return { query, user } as unknown as AuthenticatedRequest;
  };

  const getPassedStatus = (): string | undefined => {
    const filters = mockGetArtistsWithFilters.mock.calls[0][0];
    return filters.status;
  };

  it('情境 1：未登入、沒帶 status → 預設為 approved', async () => {
    const req = buildReq({});

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 2：未登入、status=pending → 被覆蓋成 approved', async () => {
    const req = buildReq({ status: 'pending' });

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 3：未登入、status=rejected → 被覆蓋成 approved', async () => {
    const req = buildReq({ status: 'rejected' });

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 4：未登入、status 帶執行期異常值 all（型別不允許但 runtime 繞得過）→ 被覆蓋成 approved', async () => {
    const req = buildReq({ status: 'all' });

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 5：登入但非 admin、status=pending → 被覆蓋成 approved', async () => {
    const req = buildReq(
      { status: 'pending' },
      { uid: 'user-1', email: 'user@test.com', role: 'user' }
    );

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 6：登入且為 admin、status=pending → 保留 pending，不被覆蓋', async () => {
    const req = buildReq(
      { status: 'pending' },
      { uid: 'admin-1', email: 'admin@test.com', role: 'admin' }
    );

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('pending');
  });

  it('情境 7：登入且為 admin、沒帶 status → 預設為 approved', async () => {
    const req = buildReq({}, { uid: 'admin-1', email: 'admin@test.com', role: 'admin' });

    await controller.getAllArtists(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });
});

describe('ArtistController.getArtistById - 公開端點不洩漏投稿者資訊', () => {
  let controller: ArtistController;
  let mockGetArtistById: jest.Mock;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetArtistById = jest.fn().mockResolvedValue({
      id: 'artist-1',
      stageName: 'Test Artist',
      status: 'approved',
      createdBy: 'uid-owner',
      createdByEmail: 'owner@example.com',
    });
    (ArtistService as jest.Mock).mockImplementation(() => ({
      getArtistById: mockGetArtistById,
    }));

    controller = new ArtistController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (
    id: string,
    user?: { uid: string; email: string; role: 'user' | 'admin' }
  ): AuthenticatedRequest => {
    return { params: { id }, user } as unknown as AuthenticatedRequest;
  };

  it('回應不含 createdBy、createdByEmail，但保留其他欄位', async () => {
    const req = buildReq('artist-1');

    await controller.getArtistById(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty('createdBy');
    expect(jsonArg).not.toHaveProperty('createdByEmail');
    expect(jsonArg.stageName).toBe('Test Artist');
    expect(jsonArg.id).toBe('artist-1');
  });

  it('rejected 狀態的藝人：回應不含 rejectedReason（getArtistById 不依 status 過濾，需靠 sanitizer 擋下）', async () => {
    mockGetArtistById.mockResolvedValue({
      id: 'artist-2',
      stageName: 'Rejected Artist',
      status: 'rejected',
      rejectedReason: '資料不完整，缺少官方帳號連結',
      createdBy: 'uid-owner',
      createdByEmail: 'owner@example.com',
    });
    const req = buildReq('artist-2');

    await controller.getArtistById(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty('rejectedReason');
    expect(jsonArg.status).toBe('rejected');
  });

  it('查詢他人投稿、且已登入非該投稿人：回應仍不含 createdBy、createdByEmail、rejectedReason', async () => {
    const req = buildReq('artist-1', { uid: 'someone-else', email: 'x@test.com', role: 'user' });

    await controller.getArtistById(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty('createdBy');
    expect(jsonArg).not.toHaveProperty('createdByEmail');
  });
});

describe('ArtistController.getArtistById - 授權查詢（本人／管理員）保留完整欄位', () => {
  let controller: ArtistController;
  let mockGetArtistById: jest.Mock;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetArtistById = jest.fn().mockResolvedValue({
      id: 'artist-1',
      stageName: 'Rejected Artist',
      status: 'rejected',
      rejectedReason: '資料不完整，缺少官方帳號連結',
      createdBy: 'uid-owner',
      createdByEmail: 'owner@example.com',
    });
    (ArtistService as jest.Mock).mockImplementation(() => ({
      getArtistById: mockGetArtistById,
    }));

    controller = new ArtistController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (
    id: string,
    user?: { uid: string; email: string; role: 'user' | 'admin' }
  ): AuthenticatedRequest => {
    return { params: { id }, user } as unknown as AuthenticatedRequest;
  };

  it('本人查詢自己被退件的投稿：保留 createdBy、createdByEmail、rejectedReason（前端擁有者判斷依賴 createdBy）', async () => {
    const req = buildReq('artist-1', {
      uid: 'uid-owner',
      email: 'owner@example.com',
      role: 'user',
    });

    await controller.getArtistById(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.createdBy).toBe('uid-owner');
    expect(jsonArg.createdByEmail).toBe('owner@example.com');
    expect(jsonArg.rejectedReason).toBe('資料不完整，缺少官方帳號連結');
  });

  it('管理員查詢任何人的投稿：保留 createdBy、createdByEmail、rejectedReason', async () => {
    const req = buildReq('artist-1', { uid: 'admin-1', email: 'admin@test.com', role: 'admin' });

    await controller.getArtistById(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.createdBy).toBe('uid-owner');
    expect(jsonArg.createdByEmail).toBe('owner@example.com');
    expect(jsonArg.rejectedReason).toBe('資料不完整，缺少官方帳號連結');
  });

  it('未登入查詢：仍不含 createdBy、createdByEmail、rejectedReason', async () => {
    const req = buildReq('artist-1');

    await controller.getArtistById(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty('createdBy');
    expect(jsonArg).not.toHaveProperty('createdByEmail');
    expect(jsonArg).not.toHaveProperty('rejectedReason');
  });
});

describe('ArtistController.getAllArtists - 公開端點不洩漏投稿者資訊', () => {
  let controller: ArtistController;
  let mockGetArtistsWithFilters: jest.Mock;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetArtistsWithFilters = jest.fn().mockResolvedValue([
      {
        id: 'artist-1',
        stageName: 'Test Artist',
        status: 'approved',
        createdBy: 'uid-owner',
        createdByEmail: 'owner@example.com',
      },
      {
        id: 'artist-2',
        stageName: 'Rejected Artist',
        status: 'rejected',
        rejectedReason: '資料不完整，缺少官方帳號連結',
        createdBy: 'uid-owner',
        createdByEmail: 'owner@example.com',
      },
    ]);
    (ArtistService as jest.Mock).mockImplementation(() => ({
      getArtistsWithFilters: mockGetArtistsWithFilters,
    }));

    controller = new ArtistController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (
    query: Record<string, string> = {},
    user?: { uid: string; email: string; role: 'user' | 'admin' }
  ): AuthenticatedRequest => {
    return { query, user } as unknown as AuthenticatedRequest;
  };

  it('未登入：回應陣列每一筆都不含 createdBy、createdByEmail、rejectedReason，但保留其他欄位', async () => {
    const req = buildReq();

    await controller.getAllArtists(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>[];
    expect(jsonArg).toHaveLength(2);
    for (const artist of jsonArg) {
      expect(artist).not.toHaveProperty('createdBy');
      expect(artist).not.toHaveProperty('createdByEmail');
      expect(artist).not.toHaveProperty('rejectedReason');
    }
    expect(jsonArg[0]?.stageName).toBe('Test Artist');
    expect(jsonArg[1]?.status).toBe('rejected');
  });

  it('管理員查詢：保留 createdBy、createdByEmail、rejectedReason（既有 status=pending/rejected 授權範圍不應被這次修正縮小）', async () => {
    const req = buildReq(
      { status: 'pending' },
      { uid: 'admin-1', email: 'admin@test.com', role: 'admin' }
    );

    await controller.getAllArtists(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>[];
    expect(jsonArg[0]?.createdBy).toBe('uid-owner');
    expect(jsonArg[0]?.createdByEmail).toBe('owner@example.com');
    expect(jsonArg[1]?.rejectedReason).toBe('資料不完整，缺少官方帳號連結');
  });

  it('本人以 createdBy=自己 UID 查詢：保留 createdBy、createdByEmail（既有授權查詢範圍不應被這次修正縮小）', async () => {
    const req = buildReq(
      { createdBy: 'uid-owner' },
      { uid: 'uid-owner', email: 'owner@example.com', role: 'user' }
    );

    await controller.getAllArtists(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>[];
    expect(jsonArg[0]?.createdBy).toBe('uid-owner');
    expect(jsonArg[0]?.createdByEmail).toBe('owner@example.com');
  });

  it('一般登入使用者、未帶 createdBy 篩選：回應仍不含 createdBy、createdByEmail、rejectedReason', async () => {
    const req = buildReq({}, { uid: 'user-1', email: 'user@test.com', role: 'user' });

    await controller.getAllArtists(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>[];
    for (const artist of jsonArg) {
      expect(artist).not.toHaveProperty('createdBy');
      expect(artist).not.toHaveProperty('createdByEmail');
      expect(artist).not.toHaveProperty('rejectedReason');
    }
  });
});

describe('ArtistController.getTopArtists - 公開端點不洩漏投稿者資訊', () => {
  let controller: ArtistController;
  let mockGetTopArtistsByUpcomingEvents: jest.Mock;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetTopArtistsByUpcomingEvents = jest.fn().mockResolvedValue([
      {
        id: 'artist-1',
        stageName: 'Test Artist',
        status: 'approved',
        createdBy: 'uid-owner',
        createdByEmail: 'owner@example.com',
      },
      {
        id: 'artist-2',
        stageName: 'Rejected Artist',
        status: 'rejected',
        rejectedReason: '資料不完整，缺少官方帳號連結',
        createdBy: 'uid-owner',
        createdByEmail: 'owner@example.com',
      },
    ]);
    (ArtistService as jest.Mock).mockImplementation(() => ({
      getTopArtistsByUpcomingEvents: mockGetTopArtistsByUpcomingEvents,
    }));

    controller = new ArtistController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (): AuthenticatedRequest => {
    return { query: {} } as unknown as AuthenticatedRequest;
  };

  it('回應陣列每一筆都不含 createdBy、createdByEmail、rejectedReason，但保留其他欄位（getTopArtists 無登入權限分支，無條件過濾）', async () => {
    const req = buildReq();

    await controller.getTopArtists(req, res as Response);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>[];
    expect(jsonArg).toHaveLength(2);
    for (const artist of jsonArg) {
      expect(artist).not.toHaveProperty('createdBy');
      expect(artist).not.toHaveProperty('createdByEmail');
      expect(artist).not.toHaveProperty('rejectedReason');
    }
    expect(jsonArg[0]?.stageName).toBe('Test Artist');
    expect(jsonArg[1]?.status).toBe('rejected');
  });
});
