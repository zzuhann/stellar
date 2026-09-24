const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// JS Date 建構子對不存在的日期（例如 2026-02-31）會靜默正規化溢位（變成 2026-03-03），
// 不會拋錯，所以重建日期後比對年/月/日是否跟輸入一致，藉此偵測出不存在的日曆日
export function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_FORMAT.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
