import { Request, Response } from 'express';
import { fetchWithRetry } from '../services/googlePlacesService';

// Re-export so existing importers and tests keep their path
export { fetchWithRetry };

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
  types?: string[];
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
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Maps service unavailable');
    }

    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Input is required', 'input');
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
      res.status(response.status).json({
        error: 'Failed to fetch predictions',
        code: 'PLACES_API_ERROR',
        details: data,
      });
    }
  };

  // Google Places Details API 代理
  placeDetails = async (req: Request, res: Response): Promise<void> => {
    if (!this.apiKey) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Maps service unavailable');
    }

    const { placeId } = req.params;

    if (!placeId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Place ID is required', 'placeId');
    }

    const referer = process.env.FRONTEND_URL || 'http://localhost:3000';
    const response = await fetchWithRetry(
      `https://places.googleapis.com/v1/places/${placeId as string}?languageCode=zh-TW`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          // types is Essentials tier like location/formattedAddress; no extra cost
          'X-Goog-FieldMask': 'location,formattedAddress,displayName,addressComponents,types',
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
        // Store form checks for 'establishment' to tell a shop from a bare address
        types: data.types ?? [],
      };

      res.json(result);
    } else {
      const errorData = (await response.json()) as { error?: string };
      res.status(response.status).json({
        error: 'Failed to fetch place details',
        code: 'PLACES_API_ERROR',
        details: errorData,
      });
    }
  };
}
import { AppError } from '../utils/AppError';
