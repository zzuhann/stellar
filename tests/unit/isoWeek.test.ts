import { getIsoWeekString } from '../../src/utils/isoWeek';

describe('getIsoWeekString', () => {
  it('跨年邊界：2025-12-29（週一）與 2026-01-02（週五）判定為同一 ISO 週', () => {
    // 2026-01-01 是週四，ISO 第 1 週固定包含該年第一個週四，
    // 因此該週的週一（2025-12-29）也屬於 2026-W01。
    const dec29 = getIsoWeekString(new Date('2025-12-29T00:00:00.000Z'));
    const jan2 = getIsoWeekString(new Date('2026-01-02T00:00:00.000Z'));

    expect(dec29).toBe('2026-W01');
    expect(jan2).toBe('2026-W01');
  });

  it('跨年邊界：2025-12-28（週日）屬於前一年最後一週，與 2025-12-29 不同週', () => {
    const dec28 = getIsoWeekString(new Date('2025-12-28T00:00:00.000Z'));
    const dec29 = getIsoWeekString(new Date('2025-12-29T00:00:00.000Z'));

    expect(dec28).not.toBe(dec29);
    expect(dec28).toBe('2025-W52');
  });

  it('全程使用 UTC：以 UTC 時刻建構的日期不受執行環境時區影響', () => {
    // 若函式誤用 local time getter，這兩個「同一天不同時刻」的 UTC 時間戳
    // 在某些時區下會被拆進不同的 ISO 週；用 UTC 就一定落在同一週。
    const morning = getIsoWeekString(new Date('2026-03-16T00:30:00.000Z'));
    const evening = getIsoWeekString(new Date('2026-03-16T23:30:00.000Z'));

    expect(morning).toBe(evening);
    expect(morning).toBe('2026-W12');
  });

  it('同一週內不同日期回傳相同週字串', () => {
    const monday = getIsoWeekString(new Date('2026-08-24T00:00:00.000Z'));
    const friday = getIsoWeekString(new Date('2026-08-28T00:00:00.000Z'));

    expect(monday).toBe(friday);
  });
});
