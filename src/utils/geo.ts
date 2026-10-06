// 場地距離最近排序（sort=distance）用的純函式，見
// specs/features/venue-distance-sort/design-backend.md「距離計算」段落。
// 沿用 src/utils/isoWeek.ts 的慣例：獨立 pure function、放 utils、附 unit test。

const EARTH_RADIUS_METERS = 6371000;

export interface Coordinates {
  lat: number;
  lng: number;
}

/** 兩點間的直線距離（公尺），Haversine 公式。輸入為合法緯經度時必為有限非負數。 */
export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * 場地座標視為缺值：lat/lng 為 null/undefined、非有限數字，或兩者同時為 0
 * （null island，資料庫慣例的佔位值）。只有一邊為 0 視為有效座標——見
 * design-backend.md「判定範圍說明」，避免誤傷理論上緯度或經度剛好為 0 的合法座標。
 */
export function isMissingVenueCoords(
  lat: number | null | undefined,
  lng: number | null | undefined
): boolean {
  if (lat == null || lng == null) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return lat === 0 && lng === 0;
}

/**
 * 把 Firestore 讀出的原始 lat/lng（可能是 null/undefined/字串/NaN，取決於歷史資料
 * 或手動修改）正規化成「兩者皆有效數字，或兩者皆為 0」，確保 Venue.lat/lng 永遠是
 * number、且與 isMissingVenueCoords 的「兩者同時為 0 視為缺值」判定一致。
 *
 * 關鍵行為：只要有一邊不是有限數字，兩邊都設為 0——不能只把缺的那一邊設成 0、
 * 另一邊維持原值，否則會變成「單側缺座標」卻意外通過 isMissingVenueCoords(0, 121.5)
 * === false 的判定（只有一邊為 0 視為有效座標），讓距離排序把半殘資料的場地誤判
 * 成有效座標參與排序。
 */
export function toValidVenueCoords(lat: unknown, lng: unknown): { lat: number; lng: number } {
  const hasValidLat = typeof lat === 'number' && Number.isFinite(lat);
  const hasValidLng = typeof lng === 'number' && Number.isFinite(lng);
  if (hasValidLat && hasValidLng) {
    return { lat: lat as number, lng: lng as number };
  }
  return { lat: 0, lng: 0 };
}
