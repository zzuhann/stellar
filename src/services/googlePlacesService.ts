import { AppError } from '../utils/AppError';

/**
 * 幫 Google Places API 的 fetch 呼叫加上 timeout 與重試。
 * 只重試網路層失敗（fetch 直接 throw，例如連線被 abort、DNS 失敗）；
 * Google API 回傳的 4xx/5xx 業務錯誤會正常回傳 Response（ok: false），不會走進 catch，
 * 因此不會被無意義地重試。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; maxAttempts?: number; delayMs?: number } = {}
): Promise<globalThis.Response> {
  const { timeoutMs = 8000, maxAttempts = 3, delayMs = 300 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error as Error;
      console.warn(`Google Places API fetch attempt ${attempt}/${maxAttempts} failed:`, {
        error: lastError.message,
        isTimeout: lastError.name === 'AbortError',
        attempt,
        willRetry: attempt < maxAttempts,
      });

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError ?? new Error('fetchWithRetry failed with no error captured');
}

export interface GooglePlaceInfo {
  placeId: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  types: string[];
}

interface GooglePlaceInfoResponse {
  id?: string;
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  types?: string[];
}

const lookupFailed = () => new AppError(422, 'PLACE_LOOKUP_FAILED', 'Failed to look up place');

// placeDetails controller returns 0 for missing coordinates, so this does its own strict lookup
export async function fetchPlaceInfo(placeId: string): Promise<GooglePlaceInfo> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Maps service unavailable');
  }

  let data: GooglePlaceInfoResponse;
  try {
    const response = await fetchWithRetry(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=zh-TW`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,location,formattedAddress,displayName,types',
          Referer: process.env.FRONTEND_URL || 'http://localhost:3000',
        },
      }
    );
    if (!response.ok) throw lookupFailed();
    data = (await response.json()) as GooglePlaceInfoResponse;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw lookupFailed();
  }

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0)) {
    throw new AppError(422, 'PLACE_NO_COORDINATES', 'Place has no coordinates');
  }

  if (data.id && data.id !== placeId) {
    console.warn('Google returned a different place id', { requested: placeId, returned: data.id });
  }

  return {
    placeId,
    lat,
    lng,
    formattedAddress: data.formattedAddress ?? '',
    types: data.types ?? [],
  };
}
