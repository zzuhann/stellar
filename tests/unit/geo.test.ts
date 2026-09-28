import { haversineDistanceMeters, isMissingVenueCoords } from '../../src/utils/geo';

describe('haversineDistanceMeters', () => {
  it('同一點距離為 0', () => {
    expect(haversineDistanceMeters({ lat: 25.033, lng: 121.5654 }, { lat: 25.033, lng: 121.5654 })).toBe(
      0
    );
  });

  it('台北 101 到台北車站約 5140~5155 公尺', () => {
    const taipei101 = { lat: 25.033, lng: 121.5654 };
    const taipeiMainStation = { lat: 25.0478, lng: 121.517 };
    const distance = haversineDistanceMeters(taipei101, taipeiMainStation);
    expect(distance).toBeGreaterThanOrEqual(5140);
    expect(distance).toBeLessThanOrEqual(5155);
  });

  it('對稱性：a→b 與 b→a 距離相同', () => {
    const a = { lat: 25.033, lng: 121.5654 };
    const b = { lat: 22.6273, lng: 120.3014 };
    expect(haversineDistanceMeters(a, b)).toBe(haversineDistanceMeters(b, a));
  });

  it('跨 180 度經線：經度 179 到 -179 應是小距離，非繞地球一圈', () => {
    const a = { lat: 0, lng: 179 };
    const b = { lat: 0, lng: -179 };
    const distance = haversineDistanceMeters(a, b);
    expect(Number.isNaN(distance)).toBe(false);
    expect(distance).toBeGreaterThan(0);
    // 2 度經度在赤道約 222km，遠小於半個地球周長（約 2 萬公里）
    expect(distance).toBeLessThan(300000);
  });
});

describe('isMissingVenueCoords', () => {
  it('lat/lng 為 undefined → true', () => {
    expect(isMissingVenueCoords(undefined, undefined)).toBe(true);
  });

  it('lat/lng 為 null → true', () => {
    expect(isMissingVenueCoords(null, null)).toBe(true);
  });

  it('lat/lng 為 NaN → true', () => {
    expect(isMissingVenueCoords(NaN, 121.5)).toBe(true);
  });

  it('lat/lng 為 Infinity → true', () => {
    expect(isMissingVenueCoords(Infinity, 121.5)).toBe(true);
  });

  it('lat=0, lng=0（兩者同時為 0）→ true', () => {
    expect(isMissingVenueCoords(0, 0)).toBe(true);
  });

  it('只有一個為 0（lat=0, lng=121.5）→ false', () => {
    expect(isMissingVenueCoords(0, 121.5)).toBe(false);
  });

  it('合法座標 → false', () => {
    expect(isMissingVenueCoords(25.033, 121.5654)).toBe(false);
  });
});
