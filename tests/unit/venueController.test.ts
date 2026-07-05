import { Response } from 'express';
import { VenueController } from '../../src/controllers/venueController';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { VenueService } from '../../src/services/venueService';
import { VenueTrackingService } from '../../src/services/venueTrackingService';

// Mock 整個 VenueService / VenueTrackingService，避免碰 Firestore；建構子也不會執行真正的欄位初始化
jest.mock('../../src/services/venueService');
jest.mock('../../src/services/venueTrackingService');

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
    (VenueTrackingService as jest.Mock).mockImplementation(() => ({
      trackVenueListServed: jest.fn().mockResolvedValue(undefined),
      trackVenueDetailServed: jest.fn().mockResolvedValue(undefined),
    }));

    controller = new VenueController();

    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };
  });

  const buildReq = (
    query: Record<string, string>,
    user?: { uid: string; email: string; role: 'user' | 'admin' }
  ): AuthenticatedRequest => {
    return {
      query,
      user,
      header: jest.fn().mockReturnValue(undefined),
      ip: '127.0.0.1',
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
});
