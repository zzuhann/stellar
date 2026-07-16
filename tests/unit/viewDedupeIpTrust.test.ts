import { EventController } from '../../src/controllers/eventController';

const mockIncrementViewCount = jest.fn();

jest.mock('../../src/services/eventService', () => ({
  EventService: jest.fn().mockImplementation(() => ({
    incrementViewCount: mockIncrementViewCount,
  })),
}));

function createResponseMock() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('IP trust for view dedupe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('event recordView should dedupe by req.ip even when x-forwarded-for changes', async () => {
    const controller = new EventController();
    const res = createResponseMock();

    const req1 = {
      params: { id: 'event-1' },
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '1.1.1.1' },
    };
    const req2 = {
      params: { id: 'event-1' },
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    };

    await controller.recordView(req1 as never, res as never);
    await controller.recordView(req2 as never, res as never);

    expect(mockIncrementViewCount).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
