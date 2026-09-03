/**
 * ISO 8601 week string ("YYYY-Www") for a given date, UTC-based.
 *
 * The ISO week containing Jan 1 may belong to the previous or next year
 * (e.g. 2025-12-29 belongs to 2026-W01 because week 1 always contains the
 * year's first Thursday). Used by venueService.computeActiveWeeks to
 * deduplicate event dates into distinct active weeks.
 *
 * Deliberately UTC-based, not Asia/Taipei — the codebase has no existing
 * timezone-conversion convention, and the window is week-granular so a
 * UTC-boundary date rolling to the "wrong" day has no practical effect.
 */
export function getIsoWeekString(date: Date): string {
  // Normalize to a UTC midnight instant, then find the Thursday of that ISO week
  // (Mon=0 .. Sun=6 so Thursday is offset +3 from Monday).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);

  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);

  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}
