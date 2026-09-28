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
