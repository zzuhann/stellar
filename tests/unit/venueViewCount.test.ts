import { VenueController } from '../../src/controllers/venueController';
import { VenueService } from '../../src/services/venueService';
import { cache } from '../../src/utils/cache';

const mockIncrementViewCount = jest.fn();

jest.mock('../../src/services/venueService');

function createResponseMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

describe('VenueController.recordView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
    (VenueService as jest.Mock).mockImplementation(() => ({
      incrementViewCount: mockIncrementViewCount,
    }));
    mockIncrementViewCount.mockResolvedValue(undefined);
  });

  it('首次瀏覽回 204，同 IP + venueId 只累加一次且不信任 x-forwarded-for', async () => {
    const controller = new VenueController();
    const res = createResponseMock();
    const req = {
      params: { id: 'venue-1' },
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '1.1.1.1' },
    };

    await controller.recordView(req as never, res as never);
    await controller.recordView(
      { ...req, headers: { 'x-forwarded-for': '8.8.8.8' } } as never,
      res as never
    );

    expect(mockIncrementViewCount).toHaveBeenCalledTimes(1);
    expect(mockIncrementViewCount).toHaveBeenCalledWith('venue-1');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('同 IP 瀏覽不同 venue 各自累加', async () => {
    const controller = new VenueController();
    const res = createResponseMock();

    await controller.recordView(
      { params: { id: 'venue-1' }, ip: '10.0.0.1' } as never,
      res as never
    );
    await controller.recordView(
      { params: { id: 'venue-2' }, ip: '10.0.0.1' } as never,
      res as never
    );

    expect(mockIncrementViewCount).toHaveBeenCalledTimes(2);
  });

  it('場地不存在回 404，其他錯誤回 500', async () => {
    const controller = new VenueController();
    const missingRes = createResponseMock();
    const failedRes = createResponseMock();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockIncrementViewCount.mockRejectedValueOnce(new Error('No document to update'));
    await controller.recordView(
      { params: { id: 'missing' }, ip: '10.0.0.1' } as never,
      missingRes as never
    );

    mockIncrementViewCount.mockRejectedValueOnce(new Error('Firestore unavailable'));
    await controller.recordView(
      { params: { id: 'failed' }, ip: '10.0.0.1' } as never,
      failedRes as never
    );

    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(failedRes.status).toHaveBeenCalledWith(500);
    errorSpy.mockRestore();
  });
});
