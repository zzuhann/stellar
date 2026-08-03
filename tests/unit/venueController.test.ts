import { Response } from 'express';
import { VenueController } from '../../src/controllers/venueController';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { VenueService } from '../../src/services/venueService';

// Mock VenueService to avoid Firestore access.
jest.mock('../../src/services/venueService');

describe('VenueController.getVenues - status 守門邏輯', () => {
  let controller: VenueController;
  let mockGetVenues: jest.Mock;
  let res: Partial<Response>;

  const dummyResult: unknown[] = [];

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetVenues = jest.fn().mockResolvedValue(dummyResult);
    (VenueService as jest.Mock).mockImplementation(() => ({
      getVenues: mockGetVenues,
    }));
    controller = new VenueController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (
    query: Record<string, string>,
    user?: { uid: string; email: string; role: 'user' | 'admin' }
  ): AuthenticatedRequest => {
    return {
      query,
      user,
    } as unknown as AuthenticatedRequest;
  };

  const getPassedStatus = (): string | undefined => {
    const params = mockGetVenues.mock.calls[0][0];
    return params.status;
  };

  it('情境 1：未登入、沒帶 status → 不強制覆蓋，維持 undefined（service 內預設 active）', async () => {
    const req = buildReq({});

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBeUndefined();
  });

  it('情境 2：未登入、status=pending → 被覆蓋成 active', async () => {
    const req = buildReq({ status: 'pending' });

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBe('active');
  });

  it('情境 3：未登入、status=all → 被覆蓋成 active', async () => {
    const req = buildReq({ status: 'all' });

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBe('active');
  });

  it('情境 4：未登入、status=rejected → 被覆蓋成 active', async () => {
    const req = buildReq({ status: 'rejected' });

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBe('active');
  });

  it('情境 5：登入但非 admin、status=inactive → 被覆蓋成 active', async () => {
    const req = buildReq(
      { status: 'inactive' },
      { uid: 'user-1', email: 'user@test.com', role: 'user' }
    );

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBe('active');
  });

  it('情境 6：登入且為 admin、status=pending → 保留 pending，不被覆蓋', async () => {
    const req = buildReq(
      { status: 'pending' },
      { uid: 'admin-1', email: 'admin@test.com', role: 'admin' }
    );

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBe('pending');
  });

  it('情境 7：登入且為 admin、沒帶 status → 不強制覆蓋，維持 undefined', async () => {
    const req = buildReq({}, { uid: 'admin-1', email: 'admin@test.com', role: 'admin' });

    await controller.getVenues(req, res as Response);

    expect(getPassedStatus()).toBeUndefined();
  });

  it('接受首頁 random 10 查詢', async () => {
    const req = buildReq({ sort: 'random', limit: '10' });

    await controller.getVenues(req, res as Response);

    expect(mockGetVenues).toHaveBeenCalledWith({ sort: 'random', limit: 10 });
  });

  it('sort=random 的回應不含 pagination（維持現況行為）', async () => {
    mockGetVenues.mockResolvedValue([{ id: 'v1' }]);
    const req = buildReq({ sort: 'random', limit: '10' });

    await controller.getVenues(req, res as Response);

    expect(res.json).toHaveBeenCalledWith({ venues: [{ id: 'v1' }] });
  });
});

// 注意：capacityRange/sort/status 的枚舉檢查與 limit 的格式/必填檢查，
// 已改由 route 層的 validateRequest({ query: venueSchemas.getVenues }) 處理，
// 對應測試在 tests/unit/venueValidation.test.ts。以下只測 controller 在
// 「輸入已經過驗證」前提下，仍需自行負責的映射與業務規則。
describe('VenueController.getVenues - 已驗證輸入的映射與業務規則', () => {
  let controller: VenueController;
  let mockGetVenues: jest.Mock;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVenues = jest.fn().mockResolvedValue({
      venues: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    (VenueService as jest.Mock).mockImplementation(() => ({
      getVenues: mockGetVenues,
    }));
    controller = new VenueController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  const buildReq = (query: Record<string, string>): AuthenticatedRequest => {
    return { query, user: undefined } as unknown as AuthenticatedRequest;
  };

  it('非 random 模式的 response 為 { venues, pagination }', async () => {
    const req = buildReq({});

    await controller.getVenues(req, res as Response);

    expect(res.json).toHaveBeenCalledWith({
      venues: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('已驗證的 search 直接透傳給 service，不再重複處理', async () => {
    await controller.getVenues(buildReq({ search: 'abc mart' }), res as Response);
    expect(mockGetVenues.mock.calls[0][0].search).toBe('abc mart');
  });

  it('未帶 search 時不傳入 service', async () => {
    await controller.getVenues(buildReq({}), res as Response);
    expect(mockGetVenues.mock.calls[0][0].search).toBeUndefined();
  });

  it('page 為合法正整數時傳入 service', async () => {
    await controller.getVenues(buildReq({ page: '2' }), res as Response);
    expect(mockGetVenues.mock.calls[0][0].page).toBe(2);
  });

  it('非 random 模式可帶 limit（不再限定僅 sort=random 使用）', async () => {
    await controller.getVenues(buildReq({ limit: '5' }), res as Response);
    expect(mockGetVenues.mock.calls[0][0].limit).toBe(5);
  });

  it('sort=random 時 page 不套用（此模式不支援分頁），即使有帶也忽略', async () => {
    mockGetVenues.mockResolvedValue([]);
    await controller.getVenues(
      buildReq({ sort: 'random', limit: '10', page: '2' }),
      res as Response
    );
    expect(mockGetVenues.mock.calls[0][0].page).toBeUndefined();
  });
});
