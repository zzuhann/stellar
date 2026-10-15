import { getTaipeiDateString } from '../../src/utils/taipeiDate';

describe('getTaipeiDateString', () => {
  // TC-026：Cloud Run 跑 UTC，台北午夜 = UTC 16:00
  it.each([
    ['2026-10-15T15:59:59.999Z', '2026-10-15'],
    ['2026-10-15T16:00:00.000Z', '2026-10-16'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01'],
  ])('TC-026 %s → %s', (iso, expected) => {
    expect(getTaipeiDateString(new Date(iso))).toBe(expected);
  });
});
