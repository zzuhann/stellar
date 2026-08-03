import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth';
import { VenueService } from '../services/venueService';
import { venueSchemas } from '../middleware/validation';
import {
  CreateVenueData,
  VenueBatchReviewItem,
  VenueBatchStatusItem,
  VenueFilterParams,
} from '../models/types';
import { sendVenueSubmissionNotification } from '../services/emailService';
import { cache } from '../utils/cache';

// req.validatedQuery 在 route 層由 validateRequest({ query: venueSchemas.getVenues })
// 寫入，已完成格式驗證與型別轉換（limit/page 已是 number、region 已正規化為合法地區）；
// 這裡用同一份 schema 推導型別，而不是對 req.query（Express 的 ParsedQs）逐欄位 `as` 轉型。
type GetVenuesQuery = z.infer<typeof venueSchemas.getVenues>;

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

  // 注意：region/capacityRange/search/sort/limit/page/status 的格式驗證
  // 由 route 層的 validateRequest({ query: venueSchemas.getVenues }) 保證，
  // 這裡只做「已驗證資料 → VenueFilterParams」的映射與業務規則（非格式）判斷。
  getVenues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { region, capacityRange, search, sort, status, limit, page } =
      (req.validatedQuery as GetVenuesQuery | undefined) ?? {};

    const params: VenueFilterParams = {};

    if (region) {
      params.region = Array.isArray(region) ? region : [region];
    }

    if (capacityRange !== undefined) {
      params.capacityRange = capacityRange;
    }

    if (search !== undefined) {
      params.search = search;
    }

    if (sort !== undefined) {
      params.sort = sort;
    }

    if (limit !== undefined) {
      params.limit = limit;
    }

    // page 僅用於一般（非 random）查詢；random 模式不套用分頁，即使有帶也忽略
    if (sort !== 'random' && page !== undefined) {
      params.page = page;
    }

    if (status !== undefined) {
      params.status = status;
    }

    // 安全性：非管理員一律只能查詢 active 狀態的場地，
    // 避免未登入或一般使用者透過 status 參數拿到 pending/rejected/inactive/all 等未公開資料
    if (params.status && params.status !== 'active' && req.user?.role !== 'admin') {
      params.status = 'active';
    }

    const result = await this.venueService.getVenues(params);

    if (Array.isArray(result)) {
      res.json({ venues: result });
    } else {
      res.json(result);
    }
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
