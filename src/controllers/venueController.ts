import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { VenueService } from '../services/venueService';
import { VenueFilterParams } from '../models/types';

export class VenueController {
  private venueService: VenueService;

  constructor() {
    this.venueService = new VenueService();
  }

  getVenues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { region, capacity_min, capacity_max, sort } = req.query;

    const params: VenueFilterParams = {};

    if (region) {
      params.region = Array.isArray(region) ? (region as string[]) : [region as string];
    }

    if (capacity_min !== undefined) {
      const min = parseInt(capacity_min as string, 10);
      if (isNaN(min) || min < 0) {
        res.status(400).json({ error: 'capacity_min must be a non-negative integer' });
        return;
      }
      params.capacity_min = min;
    }

    if (capacity_max !== undefined) {
      const max = parseInt(capacity_max as string, 10);
      if (isNaN(max) || max < 0) {
        res.status(400).json({ error: 'capacity_max must be a non-negative integer' });
        return;
      }
      params.capacity_max = max;
    }

    if (sort !== undefined) {
      if (sort !== 'eventCount' && sort !== 'name') {
        res.status(400).json({ error: 'sort must be "eventCount" or "name"' });
        return;
      }
      params.sort = sort;
    }

    if (
      params.capacity_min !== undefined &&
      params.capacity_max !== undefined &&
      params.capacity_min > params.capacity_max
    ) {
      res.status(400).json({ error: 'capacity_min cannot be greater than capacity_max' });
      return;
    }

    const venues = await this.venueService.getVenues(params);
    res.json({ venues });
  };

  getVenueById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const venue = await this.venueService.getVenueById(id as string);

    if (!venue) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json(venue);
  };

  updateVenue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const venue = await this.venueService.updateVenue(id as string, req.body);

    if (!venue) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json(venue);
  };
}
