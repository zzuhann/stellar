import { Request, Response } from 'express';

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

interface GoogleSuggestion {
  placePrediction: {
    placeId: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
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

export class PlacesController {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.apiKey) {
      console.warn('Google Maps API key not configured');
    }
  }

  // Google Places Autocomplete API 代理
  autocomplete = async (req: Request, res: Response): Promise<void> => {
    if (!this.apiKey) {
      res.status(500).json({ error: 'Google Maps API key not configured' });
      return;
    }

    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'Input is required' });
      return;
    }

    const referer = process.env.FRONTEND_URL || 'http://localhost:3000';
    const response = await fetchWithRetry('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        Referer: referer,
      },
      body: JSON.stringify({
        input,
        languageCode: 'zh-TW', // 繁體中文回應
        includedRegionCodes: ['tw'], // 限制台灣地區（不限制地理範圍）
      }),
    });

    const data = await response.json();

    if (response.ok && data.suggestions) {
      // 轉換 Google Places API 回應格式為前端期望的格式
      const predictions = data.suggestions
        .filter((suggestion: unknown) => (suggestion as GoogleSuggestion).placePrediction)
        .map((suggestion: unknown) => {
          const place = (suggestion as GoogleSuggestion).placePrediction;
          return {
            place_id: place.placeId,
            description: place.text?.text || '',
            structured_formatting: {
              main_text: place.structuredFormat?.mainText?.text || '',
              secondary_text: place.structuredFormat?.secondaryText?.text || '',
            },
          };
        });

      res.json({ predictions });
    } else {
      console.error('Google Places autocomplete error:', {
        status: response.status,
        referer,
        data,
      });
      res.status(response.status).json(data || { error: 'Failed to fetch predictions' });
    }
  };

  // Google Places Details API 代理
  placeDetails = async (req: Request, res: Response): Promise<void> => {
    if (!this.apiKey) {
      res.status(500).json({ error: 'Google Maps API key not configured' });
      return;
    }

    const { placeId } = req.params;

    if (!placeId) {
      res.status(400).json({ error: 'Place ID is required' });
      return;
    }

    const referer = process.env.FRONTEND_URL || 'http://localhost:3000';
    const response = await fetchWithRetry(
      `https://places.googleapis.com/v1/places/${placeId as string}?languageCode=zh-TW`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'location,formattedAddress,displayName,addressComponents',
          Referer: referer,
        },
      }
    );

    if (response.ok) {
      const data = (await response.json()) as GooglePlaceDetails;

      // 從 addressComponents 提取城市（台灣的縣市對應 administrative_area_level_1）
      const city =
        data.addressComponents?.find(c => c.types?.includes('administrative_area_level_1'))
          ?.longText || '';

      // 轉換為前端期望的格式
      const result = {
        geometry: {
          location: {
            lat: data.location?.latitude || 0,
            lng: data.location?.longitude || 0,
          },
        },
        formatted_address: data.formattedAddress || '',
        name: data.displayName?.text || '',
        city,
      };

      res.json(result);
    } else {
      const errorData = (await response.json()) as { error?: string };
      res.status(response.status).json(errorData || { error: 'Failed to fetch place details' });
    }
  };
}
