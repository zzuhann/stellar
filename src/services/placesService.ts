import { fetchWithRetry } from '../controllers/placesController';

// ⚠️ 與 placesController.ts 的 autocomplete/placeDetails 呼叫邏輯重複。
// design-backend.md 建議把 placesController 也改成呼叫這裡的共用函式，但那牽動既有公開
// /api/places/* 端點的行為，風險與本功能不成比例，Phase A 先求有、不做那層重構，
// 待有實際需要再合併（design-backend.md〈地點解析邏輯〉已明確允許這個折衷）。

export interface ParsedLocation {
  name: string;
  address: string;
  city: string;
  coordinates: { lat: number; lng: number };
  placeId: string;
}

interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

interface GooglePlaceDetails {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  displayName?: { text?: string };
  addressComponents?: AddressComponent[];
}

/**
 * 把店名／地址文字轉成完整地點物件：Autocomplete 取第一筆建議 → Place Details 取完整資料。
 * 任何一步失敗（無 API key、無結果、API 錯誤）都回傳 null，不拋出例外——
 * 地點解析失敗只代表 parse-caption 的 `location` 欄位是 null，不影響其他欄位。
 */
export async function resolveLocation(text: string): Promise<ParsedLocation | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const trimmed = text.trim();
  if (!apiKey || !trimmed) return null;

  const referer = process.env.FRONTEND_URL || 'http://localhost:3000';

  let autocompleteRes: globalThis.Response;
  try {
    autocompleteRes = await fetchWithRetry('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, Referer: referer },
      body: JSON.stringify({ input: trimmed, languageCode: 'zh-TW', includedRegionCodes: ['tw'] }),
    });
  } catch (error) {
    console.warn('Places autocomplete 呼叫失敗:', error);
    return null;
  }
  if (!autocompleteRes.ok) return null;

  const data = await autocompleteRes.json();
  const placeId = data?.suggestions?.[0]?.placePrediction?.placeId;
  if (!placeId) return null; // 搜尋無結果 → location 維持 null

  let detailsRes: globalThis.Response;
  try {
    detailsRes = await fetchWithRetry(
      `https://places.googleapis.com/v1/places/${placeId}?languageCode=zh-TW`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'location,formattedAddress,displayName,addressComponents',
          Referer: referer,
        },
      }
    );
  } catch (error) {
    console.warn('Places details 呼叫失敗:', error);
    return null;
  }
  if (!detailsRes.ok) return null;

  const details = (await detailsRes.json()) as GooglePlaceDetails;
  const city =
    details.addressComponents?.find(c => c.types?.includes('administrative_area_level_1'))
      ?.longText || '';

  return {
    name: details.displayName?.text || trimmed,
    address: details.formattedAddress || '',
    city,
    coordinates: { lat: details.location?.latitude ?? 0, lng: details.location?.longitude ?? 0 },
    placeId,
  };
}
