import { EventController } from '../../src/controllers/eventController';
import { VenueController } from '../../src/controllers/venueController';

const mockIncrementViewCount = jest.fn();
const mockGetVenueById = jest.fn();
const mockTrackVenueDetailServed = jest.fn();

jest.mock('../../src/services/eventService', () => ({
  EventService: jest.fn().mockImplementation(() => ({
    incrementViewCount: mockIncrementViewCount,
  })),
}));

jest.mock('../../src/services/venueService', () => ({
  VenueService: jest.fn().mockImplementation(() => ({
    getVenueById: mockGetVenueById,
  })),
}));

jest.mock('../../src/services/venueTrackingService', () => ({
  VenueTrackingService: jest.fn().mockImplementation(() => ({
    trackVenueDetailServed: mockTrackVenueDetailServed,
    trackVenueListServed: jest.fn(),
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

  test('venue detail served should dedupe by req.ip even when x-forwarded-for changes', async () => {
    const controller = new VenueController();
    const res = createResponseMock();
    mockGetVenueById.mockResolvedValue({ id: 'venue-1' });

    const req1 = {
      params: { id: 'venue-1' },
      ip: '10.0.0.2',
      headers: { 'x-forwarded-for': '2.2.2.2' },
      header: jest.fn().mockReturnValue(undefined),
      user: undefined,
    };
    const req2 = {
      params: { id: 'venue-1' },
      ip: '10.0.0.2',
      headers: { 'x-forwarded-for': '9.9.9.9' },
      header: jest.fn().mockReturnValue(undefined),
      user: undefined,
    };

    await controller.getVenueById(req1 as never, res as never);
    await controller.getVenueById(req2 as never, res as never);

    expect(mockGetVenueById).toHaveBeenCalledTimes(2);
    expect(mockTrackVenueDetailServed).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledTimes(2);
  });
});
