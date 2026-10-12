const LEADING_COUNTRY = /^(台灣|taiwan)/i;
const LEADING_POSTAL_CODE = /^\d{3}(?:\d{2,3})?/;
const TRAILING_COUNTRY = /台灣$/;

export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return '';
  let result = address.normalize('NFKC').replace(/\s/g, '').replace(/臺/g, '台');
  // Country and postal code can appear in either order, so strip country again at the end
  result = result.replace(LEADING_COUNTRY, '').replace(LEADING_POSTAL_CODE, '');
  result = result.replace(LEADING_COUNTRY, '').replace(TRAILING_COUNTRY, '');
  return result;
}

export function isSameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeAddress(a);
  return left !== '' && left === normalizeAddress(b);
}
