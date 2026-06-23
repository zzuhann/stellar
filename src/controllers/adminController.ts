import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { AdminService, AdminQueryParams, AdminVenueQueryParams } from '../services/adminService';
import { ArtistService } from '../services/artistService';
import { VenueStatus } from '../models/types';

export class AdminController {
  private adminService: AdminService;
  private artistService: ArtistService;

  constructor() {
    this.adminService = new AdminService();
    this.artistService = new ArtistService();
  }

  getEvents = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const params: AdminQueryParams = {
        search: req.query.search as string | undefined,
        slug: req.query.slug as string | undefined,
        id: req.query.id as string | undefined,
        status: req.query.status as AdminQueryParams['status'],
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };

      const result = await this.adminService.getAdminEvents(params);
      res.json(result);
    } catch (err) {
      console.error('[AdminController] getEvents error:', err);
      next(err);
    }
  };

  getArtists = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const params: AdminQueryParams = {
        search: req.query.search as string | undefined,
        slug: req.query.slug as string | undefined,
        id: req.query.id as string | undefined,
        status: req.query.status as AdminQueryParams['status'],
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };

      const result = await this.adminService.getAdminArtists(params);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getVenues = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const params: AdminVenueQueryParams = {
        search: req.query.search as string | undefined,
        status: req.query.status as VenueStatus | undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };

      const result = await this.adminService.getAdminVenues(params);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  deleteArtistsBatch = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { ids } = req.body as { ids: string[] };
      const result = await this.artistService.deleteArtistsBatch(ids);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
