import { Timestamp } from 'firebase-admin/firestore';
import { CoffeeEvent } from '../../src/models/types';
import { toPublicEvent, toPublicEvents } from '../../src/utils/eventSanitizer';

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
