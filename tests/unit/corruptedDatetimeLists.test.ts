import { Timestamp } from 'firebase-admin/firestore';
import { ArtistService } from '../../src/services/artistService';
import { UserService } from '../../src/services/userService';
import { EventService } from '../../src/services/eventService';

// One approved event with a corrupted datetime must not 500 the whole list.

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const mockEventsGet = jest.fn();
const mockFavoritesGet = jest.fn();
const mockArtistDocGet = jest.fn();

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn((name: string) => {
      if (name === 'coffeeEvents') return { where: jest.fn(() => ({ get: mockEventsGet })) };
      if (name === 'userFavorites') return { where: jest.fn(() => ({ get: mockFavoritesGet })) };
      return { doc: jest.fn((id: string) => ({ get: () => mockArtistDocGet(id) })) };
    }),
  },
}));

jest.mock('../../src/utils/firestoreTimeout', () => ({
  withTimeoutAndRetry: jest.fn((fn: () => unknown) => fn()),
}));

const eventDoc = (id: string, datetime: unknown) => ({
  id,
  data: () => ({
    title: id,
    description: '',
    location: { name: 'Venue', address: 'Address', coordinates: { lat: 25, lng: 121 } },
    artists: [{ id: 'artist-1', name: 'Artist' }],
    datetime,
    status: 'approved',
    createdBy: 'uid-owner',
  }),
});

const goodDatetime = { start: makeTimestamp('2025-01-01'), end: makeTimestamp('2099-01-01') };

describe('壞掉的 datetime 不讓整個列表噴錯', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockEventsGet.mockResolvedValue({
      docs: [eventDoc('event-good', goodDatetime), eventDoc('event-corrupted', undefined)],
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('熱門藝人：跳過壞資料，只計算正常活動，並記錄含活動 id 的 log', async () => {
    mockArtistDocGet.mockResolvedValue({
      exists: true,
      id: 'artist-1',
      data: () => ({ stageName: 'Artist', status: 'approved' }),
    });

    const result = await new ArtistService().getTopArtistsByUpcomingEvents(10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'artist-1', upcomingEventCount: 1 });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('event-corrupted'));
  });

  it('熱門藝人與 /events：共用同一份基礎快取（只讀一次 Firestore），且都以當下時間排除快取建立後才結束的活動', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      mockEventsGet.mockResolvedValue({
        docs: [
          eventDoc('event-good', {
            start: makeTimestamp('2027-01-01T00:00:00.000Z'),
            end: makeTimestamp('2027-01-02T00:00:00.000Z'),
          }),
        ],
      });
      jest.setSystemTime(new Date('2027-01-01T12:00:00.000Z'));
      await new EventService().getEventsWithFilters({ status: 'approved' }); // fills the 24h base cache

      jest.setSystemTime(new Date('2027-01-02T01:00:00.000Z')); // event-good has ended
      const result = await new ArtistService().getTopArtistsByUpcomingEvents(10);

      expect(result).toEqual([]);
      const list = (await new EventService().getEventsWithFilters({ status: 'approved' })) as {
        events: unknown[];
      };
      expect(list.events).toEqual([]); // /events drops it too while the base cache is still valid
      expect(mockEventsGet).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('我的投稿分頁：createdAt 壞掉的排最後、不噴錯；datetime 壞掉的仍列出，讓投稿者能看到並修正', async () => {
    const withCreatedAt = (id: string, createdAt: unknown) => ({
      id,
      data: () => ({ ...eventDoc(id, goodDatetime).data(), createdAt }),
    });
    mockEventsGet.mockResolvedValue({
      docs: [
        withCreatedAt('event-bad-created-at', 'not-a-timestamp'),
        withCreatedAt('event-good', makeTimestamp('2025-01-01')),
        eventDoc('event-corrupted', undefined),
      ],
    });

    const result = await new EventService().getUserSubmittedEventsPaginated('uid-owner');

    expect(result.events.map(e => e.id)).toEqual([
      'event-good',
      'event-bad-created-at',
      'event-corrupted',
    ]);
    expect(result.summary.total).toBe(3);
  });

  it('GET /events?createdBy=：createdAt 壞掉時預設排序不噴錯，視為最舊', async () => {
    mockEventsGet.mockResolvedValue({
      docs: [
        {
          id: 'event-a',
          data: () => ({ ...eventDoc('event-a', goodDatetime).data(), createdAt: 'x' }),
        },
        {
          id: 'event-b',
          data: () => ({
            ...eventDoc('event-b', goodDatetime).data(),
            createdAt: makeTimestamp('2025-01-01'),
          }),
        },
      ],
    });

    const result = (await new EventService().getEventsWithFilters({ createdBy: 'uid-owner' })) as {
      events: { id: string }[];
    };

    expect(result.events.map(e => e.id)).toEqual(['event-b', 'event-a']);
  });

  it.each(['notEnded', 'all'] as const)(
    '收藏列表（status=%s、依開始時間排序）：跳過壞資料，其餘收藏正常回傳',
    async status => {
      mockFavoritesGet.mockResolvedValue({
        empty: false,
        docs: ['event-good', 'event-corrupted'].map((eventId, i) => ({
          id: `fav-${i}`,
          data: () => ({ userId: 'user-1', eventId, createdAt: makeTimestamp('2025-01-01') }),
        })),
      });

      const result = await new UserService().getFavorites('user-1', { status, sort: 'startTime' });

      expect(result.favorites.map(f => f.event.id)).toEqual(['event-good']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('event-corrupted'));
    }
  );

  it('收藏列表：活動文件內容帶了不同的 id 欄位時，仍以 Firestore 文件 ID 為準，收藏不會消失', async () => {
    mockEventsGet.mockResolvedValue({
      docs: [
        {
          id: 'event-good',
          data: () => ({ ...eventDoc('event-good', goodDatetime).data(), id: 'stale-id' }),
        },
      ],
    });
    mockFavoritesGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'fav-0',
          data: () => ({
            userId: 'user-1',
            eventId: 'event-good',
            createdAt: makeTimestamp('2025-01-01'),
          }),
        },
      ],
    });

    const result = await new UserService().getFavorites('user-1', {});

    expect(result.favorites.map(f => f.event.id)).toEqual(['event-good']);
  });

  it('收藏列表（預設依收藏時間排序）：收藏紀錄的 createdAt 壞掉時不噴錯，視為最舊', async () => {
    mockEventsGet.mockResolvedValue({
      docs: [eventDoc('event-a', goodDatetime), eventDoc('event-b', goodDatetime)],
    });
    mockFavoritesGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'fav-a',
          data: () => ({ userId: 'user-1', eventId: 'event-a', createdAt: '2025-01-01' }),
        },
        {
          id: 'fav-b',
          data: () => ({
            userId: 'user-1',
            eventId: 'event-b',
            createdAt: makeTimestamp('2025-01-01'),
          }),
        },
      ],
    });

    const result = await new UserService().getFavorites('user-1', {});

    expect(result.favorites.map(f => f.event.id)).toEqual(['event-b', 'event-a']);
  });
});
