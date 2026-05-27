import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { VenueService } from '../services/venueService';
import {
  CreateVenueData,
  VenueBatchReviewItem,
  VenueBatchStatusItem,
  VenueFilterParams,
} from '../models/types';

export class VenueController {
  private venueService: VenueService;

  constructor() {
    this.venueService = new VenueService();
  }

  createVenue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const data = req.body as CreateVenueData;
    const venue = await this.venueService.createVenue(data);
    res.status(201).json(venue);
  };

  getVenues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { region, capacityRange, sort, status } = req.query;

    const params: VenueFilterParams = {};

    if (region) {
      params.region = Array.isArray(region) ? (region as string[]) : [region as string];
    }

    if (capacityRange !== undefined) {
      const validRanges = ['20以下', '20-40', '40-60', '60以上'];
      if (!validRanges.includes(capacityRange as string)) {
        res
          .status(400)
          .json({ error: `capacityRange must be one of: ${validRanges.join(', ')}` });
        return;
      }
      params.capacityRange = capacityRange as VenueFilterParams['capacityRange'];
    }

    if (sort !== undefined) {
      if (sort !== 'eventCount' && sort !== 'name') {
        res.status(400).json({ error: 'sort must be "eventCount" or "name"' });
        return;
      }
      params.sort = sort;
    }

    if (status !== undefined) {
      const validStatuses = ['active', 'inactive', 'pending', 'rejected', 'all'];
      if (!validStatuses.includes(status as string)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
      }
      params.status = status as VenueFilterParams['status'];
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
    const updated = await this.venueService.updateVenue(id as string, req.body);

    if (!updated) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json({ message: 'Venue updated' });
  };

  deleteVenue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const found = await this.venueService.deactivateVenue(id as string);

    if (!found) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.status(200).json({ message: 'Venue deactivated' });
  };

  getAdminVenueById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const venue = await this.venueService.getAdminVenueById(id as string);

    if (!venue) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json(venue);
  };

  batchReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { updates } = req.body as { updates: VenueBatchReviewItem[] };
    const processed = await this.venueService.batchReview(updates);
    res.json({ message: 'Batch review completed', processed });
  };

  batchStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { updates } = req.body as { updates: VenueBatchStatusItem[] };
    const processed = await this.venueService.batchStatus(updates);
    res.json({ message: 'Batch status update completed', processed });
  };

  permanentDeleteVenue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const result = await this.venueService.permanentDeleteVenue(id as string);

    if (result === 'not_found') {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    if (result === 'has_events') {
      res.status(400).json({
        error: 'Cannot permanently delete a venue that has associated events. Remove event associations first.',
      });
      return;
    }

    res.status(200).json({ message: 'Venue permanently deleted' });
  };
}
