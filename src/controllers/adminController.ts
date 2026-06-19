import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { AdminService, AdminQueryParams } from '../services/adminService';

export class AdminController {
  private adminService: AdminService;

  constructor() {
    this.adminService = new AdminService();
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
}
