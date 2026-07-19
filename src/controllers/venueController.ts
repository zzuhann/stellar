import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { VenueService } from '../services/venueService';
import {
  CreateVenueData,
  VenueBatchReviewItem,
  VenueBatchStatusItem,
  VenueFilterParams,
} from '../models/types';
import { sendVenueSubmissionNotification } from '../services/emailService';
import { cache } from '../utils/cache';

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

  createVenueSubmission = async (req: Request, res: Response): Promise<void> => {
    const data = req.body as CreateVenueData;
    const venue = await this.venueService.createVenue(data);
    void sendVenueSubmissionNotification(venue.name);
    res.status(201).json(venue);
  };

  getVenues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { region, capacityRange, sort, status, limit } = req.query;

    const params: VenueFilterParams = {};

    if (region) {
      params.region = Array.isArray(region) ? (region as string[]) : [region as string];
    }

    if (capacityRange !== undefined) {
      const validRanges = ['20以下', '20-40', '40-60', '60以上'];
      if (!validRanges.includes(capacityRange as string)) {
        res.status(400).json({ error: `capacityRange must be one of: ${validRanges.join(', ')}` });
        return;
      }
      params.capacityRange = capacityRange as VenueFilterParams['capacityRange'];
    }

    if (sort !== undefined) {
      if (sort !== 'eventCount' && sort !== 'name' && sort !== 'newest' && sort !== 'random') {
        res.status(400).json({
          error: 'sort must be "eventCount", "name", "newest", or "random"',
        });
        return;
      }
      params.sort = sort;
    }

    if (sort === 'random' && limit === undefined) {
      res.status(400).json({ error: 'limit is required when sort is "random"' });
      return;
    }

    if (limit !== undefined) {
      if (sort !== 'random') {
        res.status(400).json({ error: 'limit is only supported when sort is "random"' });
        return;
      }

      const parsedLimit = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
      if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
        res.status(400).json({ error: 'limit must be a positive integer' });
        return;
      }
      params.limit = parsedLimit;
    }

    if (status !== undefined) {
      const validStatuses = ['active', 'inactive', 'pending', 'rejected', 'all'];
      if (!validStatuses.includes(status as string)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
      }
      params.status = status as VenueFilterParams['status'];
    }

    // 安全性：非管理員一律只能查詢 active 狀態的場地，
    // 避免未登入或一般使用者透過 status 參數拿到 pending/rejected/inactive/all 等未公開資料
    if (params.status && params.status !== 'active' && req.user?.role !== 'admin') {
      params.status = 'active';
    }

    const venues = await this.venueService.getVenues(params);
    res.json({ venues });
  };

  getVenueById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = String(req.params.id ?? '');
    const venue = await this.venueService.getVenueById(id);

    if (!venue) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json(venue);
  };

  recordView = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id ?? '');
      const dedupKey = `venue_view_dedup:${req.ip ?? 'unknown'}:${id}`;

      if (cache.get(dedupKey) !== null) {
        res.status(204).send();
        return;
      }

      await this.venueService.incrementViewCount(id);
      cache.set(dedupKey, true, 60);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes('No document to update')) {
        res.status(404).json({ error: 'Venue not found' });
        return;
      }
      console.error('Error recording venue view:', error);
      res.status(500).json({ error: 'Failed to record venue view' });
    }
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
        error:
          'Cannot permanently delete a venue that has associated events. Remove event associations first.',
      });
      return;
    }

    res.status(200).json({ message: 'Venue permanently deleted' });
  };
}
