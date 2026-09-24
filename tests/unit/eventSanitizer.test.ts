import { Timestamp } from 'firebase-admin/firestore';
import { CoffeeEvent } from '../../src/models/types';
import {
  toPublicEvent,
  toPublicEvents,
  serializeEventDatetime,
  serializeEventsDatetime,
  getInvalidEventDatetimeReason,
} from '../../src/utils/eventSanitizer';

const makeTimestamp = (isoDate: string): Timestamp =>
  ({ toDate: () => new Date(isoDate), toMillis: () => new Date(isoDate).getTime() }) as Timestamp;

const baseEvent = (overrides: Partial<CoffeeEvent> = {}): CoffeeEvent =>
  ({
    id: 'event-1',
    title: 'Test Event',
    description: '',
    mainImage: '',
    artists: [],
    location: { address: 'Taipei', coordinates: { lat: 25, lng: 121 } },
    datetime: { start: makeTimestamp('2025-01-01'), end: makeTimestamp('2025-01-02') },
    status: 'approved',
    createdBy: 'uid-owner',
    createdByEmail: 'owner@example.com',
    createdAt: makeTimestamp('2024-12-01'),
    updatedAt: makeTimestamp('2024-12-01'),
    ...overrides,
  }) as unknown as CoffeeEvent;

describe('toPublicEvent', () => {
  it('移除 createdByEmail 欄位', () => {
    const result = toPublicEvent(baseEvent());
    expect(result).not.toHaveProperty('createdByEmail');
  });

  it('createdByEmail 為 undefined 時仍正常運作、不拋錯', () => {
    const event = baseEvent({ createdByEmail: undefined });
    const result = toPublicEvent(event);
    expect(result).not.toHaveProperty('createdByEmail');
  });

  it('保留 createdBy（UID），前端依賴此欄位判斷本人投稿', () => {
    const result = toPublicEvent(baseEvent());
    expect(result.createdBy).toBe('uid-owner');
  });

  it('保留其他所有欄位不受影響', () => {
    const event = baseEvent({ title: '生日應援活動', status: 'pending' });
    const result = toPublicEvent(event);
    expect(result.title).toBe('生日應援活動');
    expect(result.status).toBe('pending');
    expect(result.id).toBe('event-1');
  });

  it('不修改原始物件（避免共用快取被意外污染）', () => {
    const event = baseEvent();
    toPublicEvent(event);
    expect(event).toHaveProperty('createdByEmail');
    expect(event.createdByEmail).toBe('owner@example.com');
  });

  it('對帶有 isFavorited 的 CoffeeEventWithFavorite 也能正確移除 createdByEmail', () => {
    const eventWithFavorite = { ...baseEvent(), isFavorited: true };
    const result = toPublicEvent(eventWithFavorite);
    expect(result).not.toHaveProperty('createdByEmail');
    expect(result.isFavorited).toBe(true);
  });

  it('回傳型別不含 createdByEmail（compile-time 防退步：若實作退回 as T 蓋型別，這裡會編譯失敗）', () => {
    const result = toPublicEvent(baseEvent());
    // @ts-expect-error createdByEmail 不應存在於回傳型別上
    void result.createdByEmail;
  });
});

describe('toPublicEvents', () => {
  it('空陣列回傳空陣列', () => {
    expect(toPublicEvents([])).toEqual([]);
  });

  it('對陣列中每一筆都移除 createdByEmail', () => {
    const events = [
      baseEvent({ id: 'e1', createdByEmail: 'a@example.com' }),
      baseEvent({ id: 'e2', createdByEmail: 'b@example.com' }),
    ];
    const result = toPublicEvents(events);
    expect(result.every(e => !('createdByEmail' in e))).toBe(true);
    expect(result.map(e => e.id)).toEqual(['e1', 'e2']);
  });
});

describe('serializeEventDatetime', () => {
  it('把 datetime.start/end 從 Timestamp 轉成 ISO 8601 字串', () => {
    const event = baseEvent({
      datetime: {
        start: makeTimestamp('2027-03-01T00:00:00.000Z'),
        end: makeTimestamp('2027-03-02T08:30:00.000Z'),
      },
    });

    const result = serializeEventDatetime(event);

    expect(result.datetime.start).toBe('2027-03-01T00:00:00.000Z');
    expect(result.datetime.end).toBe('2027-03-02T08:30:00.000Z');
  });

  it('不修改其他欄位', () => {
    const event = baseEvent({ title: '生日應援活動', id: 'event-42' });
    const result = serializeEventDatetime(event);
    expect(result.title).toBe('生日應援活動');
    expect(result.id).toBe('event-42');
  });

  it('不修改原始物件的 datetime（避免共用快取被意外污染）', () => {
    const event = baseEvent();
    serializeEventDatetime(event);
    expect(event.datetime.start).not.toBe('string');
    expect(typeof event.datetime.start).toBe('object');
  });
});

describe('getInvalidEventDatetimeReason', () => {
  it('datetime 完整且有效時回傳 null', () => {
    const event = baseEvent();
    expect(getInvalidEventDatetimeReason(event)).toBeNull();
  });

  it('datetime 整個缺失時回傳含 datetime.start 的原因字串', () => {
    expect(getInvalidEventDatetimeReason({ datetime: undefined })).toContain('datetime.start');
  });

  it('datetime.start 缺失時回傳含 datetime.start 的原因字串', () => {
    const reason = getInvalidEventDatetimeReason({
      datetime: { end: makeTimestamp('2025-01-02') },
    });
    expect(reason).toContain('datetime.start');
  });

  it('datetime.end 缺失時回傳含 datetime.end 的原因字串', () => {
    const reason = getInvalidEventDatetimeReason({
      datetime: { start: makeTimestamp('2025-01-01') },
    });
    expect(reason).toContain('datetime.end');
  });

  it('datetime.start 不是 Firestore Timestamp（純字串）時回傳原因字串', () => {
    const reason = getInvalidEventDatetimeReason({
      datetime: { start: '2025-01-01', end: makeTimestamp('2025-01-02') },
    });
    expect(reason).toContain('datetime.start');
  });

  it('toDate() 產生 Invalid Date 時回傳原因字串', () => {
    const invalidTimestamp = { toDate: () => new Date('not-a-date') } as Timestamp;
    const reason = getInvalidEventDatetimeReason({
      datetime: { start: invalidTimestamp, end: makeTimestamp('2025-01-02') },
    });
    expect(reason).toContain('Invalid Date');
  });
});

describe('serializeEventsDatetime', () => {
  it('空陣列回傳空陣列', () => {
    expect(serializeEventsDatetime([])).toEqual([]);
  });

  it('對陣列中每一筆都轉換 datetime', () => {
    const events = [
      baseEvent({
        id: 'e1',
        datetime: { start: makeTimestamp('2027-01-01'), end: makeTimestamp('2027-01-02') },
      }),
      baseEvent({
        id: 'e2',
        datetime: { start: makeTimestamp('2027-02-01'), end: makeTimestamp('2027-02-02') },
      }),
    ];
    const result = serializeEventsDatetime(events);
    expect(result.every(e => typeof e.datetime.start === 'string')).toBe(true);
    expect(result.map(e => e.id)).toEqual(['e1', 'e2']);
  });
});
