import { FieldValue } from 'firebase-admin/firestore';
import { VenueService } from '../../src/services/venueService';

const mockUpdate = jest.fn();
const mockSet = jest.fn();
const venueDocFn = jest.fn(() => ({ update: mockUpdate }));
const dailyDocFn = jest.fn((_id: string) => ({ set: mockSet }));

jest.mock('../../src/config/firebase', () => ({
  hasFirebaseConfig: true,
  db: {
    collection: jest.fn(),
  },
}));

describe('VenueService.incrementViewCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const firebase = jest.requireMock('../../src/config/firebase');
    (firebase.db.collection as jest.Mock).mockImplementation((name: string) =>
      name === 'venueViewDaily' ? { doc: dailyDocFn } : { doc: venueDocFn }
    );
    mockUpdate.mockResolvedValue(undefined);
    mockSet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('使用 FieldValue.increment(1) 原子累加既有 viewCount 總數', async () => {
    const incrementSpy = jest.spyOn(FieldValue, 'increment');

    await new VenueService().incrementViewCount('venue-1');

    expect(incrementSpy).toHaveBeenCalledWith(1);
    expect(mockUpdate).toHaveBeenCalledWith({ viewCount: expect.anything() });
    incrementSpy.mockRestore();
  });

  it('同時寫入 venueViewDaily 當日 bucket，doc id 為 {venueId}_{UTC date}，merge:true + atomic increment', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T12:00:00.000Z'));

    await new VenueService().incrementViewCount('venue-1');

    expect(dailyDocFn).toHaveBeenCalledWith('venue-1_2026-09-02');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: 'venue-1',
        date: '2026-09-02',
        count: expect.anything(),
        expireAt: expect.anything(),
      }),
      { merge: true }
    );
  });

  it('日期字串使用 UTC，不受執行環境時區影響（近午夜時刻不跨日）', async () => {
    // 23:30 UTC 仍是同一個 UTC 日期，驗證沒有做 local time 轉換
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T23:30:00.000Z'));

    await new VenueService().incrementViewCount('venue-1');

    expect(dailyDocFn).toHaveBeenCalledWith('venue-1_2026-09-02');
  });

  it('同一場地同一天（UTC）多次呼叫，寫入同一個 doc id，而非新增多筆 doc', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T08:00:00.000Z'));

    const service = new VenueService();
    await service.incrementViewCount('venue-1');
    await service.incrementViewCount('venue-1');
    await service.incrementViewCount('venue-1');

    expect(dailyDocFn).toHaveBeenCalledTimes(3);
    dailyDocFn.mock.calls.forEach(call => expect(call[0]).toBe('venue-1_2026-09-02'));
    expect(mockSet).toHaveBeenCalledTimes(3);
  });

  it('不同場地同一天各自寫入獨立的 doc id', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T08:00:00.000Z'));

    const service = new VenueService();
    await service.incrementViewCount('venue-1');
    await service.incrementViewCount('venue-2');

    expect(dailyDocFn).toHaveBeenNthCalledWith(1, 'venue-1_2026-09-02');
    expect(dailyDocFn).toHaveBeenNthCalledWith(2, 'venue-2_2026-09-02');
  });
});
