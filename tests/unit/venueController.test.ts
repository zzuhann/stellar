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

  it.each([
    [{ sort: 'random' }, 'limit is required when sort is "random"'],
    [{ sort: 'random', limit: '0' }, 'limit must be a positive integer'],
    [{ sort: 'random', limit: '1.5' }, 'limit must be a positive integer'],
    [{ sort: 'newest', limit: '10' }, 'limit is only supported when sort is "random"'],
  ])('拒絕不合法的 random/limit 組合：%o', async (query, error) => {
    const req = buildReq(query);

    await controller.getVenues(req, res as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error });
    expect(mockGetVenues).not.toHaveBeenCalled();
  });
});
