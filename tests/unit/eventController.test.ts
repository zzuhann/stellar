import { Response } from 'express';
import { EventController } from '../../src/controllers/eventController';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { EventService } from '../../src/services/eventService';

// Mock 整個 EventService，避免碰 Firestore；建構子也不會執行真正的欄位初始化
jest.mock('../../src/services/eventService');

describe('EventController.getActiveEvents - status 守門邏輯', () => {
  let controller: EventController;
  let mockGetEventsWithFilters: jest.Mock;
  let res: Partial<Response>;

  const dummyResult = { events: [], total: 0 };

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetEventsWithFilters = jest.fn().mockResolvedValue(dummyResult);
    (EventService as jest.Mock).mockImplementation(() => ({
      getEventsWithFilters: mockGetEventsWithFilters,
    }));

    controller = new EventController();

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
    const filters = mockGetEventsWithFilters.mock.calls[0][0];
    return filters.status;
  };

  it('情境 1：未登入、沒帶 status → 預設為 approved', async () => {
    const req = buildReq({});

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 2：未登入、status=pending → 被覆蓋成 approved', async () => {
    const req = buildReq({ status: 'pending' });

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 3：未登入、status=rejected → 被覆蓋成 approved', async () => {
    const req = buildReq({ status: 'rejected' });

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 4：未登入、status 帶執行期異常值 all（型別不允許但 runtime 繞得過）→ 被覆蓋成 approved', async () => {
    const req = buildReq({ status: 'all' });

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 5：登入但非 admin、status=pending → 被覆蓋成 approved', async () => {
    const req = buildReq(
      { status: 'pending' },
      { uid: 'user-1', email: 'user@test.com', role: 'user' }
    );

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });

  it('情境 6：登入且為 admin、status=pending → 保留 pending，不被覆蓋', async () => {
    const req = buildReq(
      { status: 'pending' },
      { uid: 'admin-1', email: 'admin@test.com', role: 'admin' }
    );

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('pending');
  });

  it('情境 7：登入且為 admin、沒帶 status → 預設為 approved', async () => {
    const req = buildReq({}, { uid: 'admin-1', email: 'admin@test.com', role: 'admin' });

    await controller.getActiveEvents(req, res as Response);

    expect(getPassedStatus()).toBe('approved');
  });
});
