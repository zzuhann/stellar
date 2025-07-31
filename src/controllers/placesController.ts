import { Request, Response } from 'express';

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

interface GooglePlaceDetails {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  displayName?: { text?: string };
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
    try {
      if (!this.apiKey) {
        res.status(500).json({ error: 'Google Maps API key not configured' });
        return;
      }

      const { input } = req.body;

      if (!input || typeof input !== 'string') {
        res.status(400).json({ error: 'Input is required' });
        return;
      }

      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          Referer: 'http://localhost:3000/',
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
        res.status(response.status).json(data || { error: 'Failed to fetch predictions' });
      }
    } catch (error) {
      console.error('Error in places autocomplete:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Google Places Details API 代理
  placeDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.apiKey) {
        res.status(500).json({ error: 'Google Maps API key not configured' });
        return;
      }

      const { placeId } = req.params;

      if (!placeId) {
        res.status(400).json({ error: 'Place ID is required' });
        return;
      }

      const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}?languageCode=zh-TW`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'location,formattedAddress,displayName',
            Referer: 'http://localhost:3000/',
          },
        }
      );

      if (response.ok) {
        const data = (await response.json()) as GooglePlaceDetails;

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
        };

        res.json(result);
      } else {
        const errorData = (await response.json()) as { error?: string };
        res.status(response.status).json(errorData || { error: 'Failed to fetch place details' });
      }
    } catch (error) {
      console.error('Error in place details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
