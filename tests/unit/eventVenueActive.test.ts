import { EventService } from '../../src/services/eventService';
import { cache } from '../../src/utils/cache';

const mockEventGet = jest.fn();
const mockVenueGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: name === 'venues' ? mockVenueGet : mockEventGet,
      })),
    })),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

const eventData = {
  artists: [{ id: 'artist-1', name: 'Artist', slug: 'artist' }],
  title: 'Event',
  description: '',
  location: {
    name: 'Venue',
    address: 'Address',
    coordinates: { lat: 25, lng: 121 },
    venueId: 'venue-1',
  },
  datetime: {},
  socialMedia: {},
  status: 'approved',
  createdBy: 'user-1',
};

describe('EventService.getEventById venueActive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
    mockEventGet.mockResolvedValue({
      exists: true,
      id: 'event-1',
      data: () => eventData,
    });
  });

  it.each([
    ['active', true],
    ['inactive', false],
  ] as const)('場地狀態為 %s 時回傳 venueActive=%s', async (status, expected) => {
    mockVenueGet.mockResolvedValue({ exists: true, data: () => ({ status }) });

    const event = await new EventService().getEventById('event-1');

    expect(event?.location.venueActive).toBe(expected);
  });
});
