import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { ArtistService } from '../services/artistService';
import { FavoriteFilterParams } from '../models/types';
import { AppError } from '../utils/AppError';

export class UserController {
  private userService: UserService;
  private eventService: EventService;
  private artistService: ArtistService;

  constructor() {
    this.userService = new UserService();
    this.eventService = new EventService();
    this.artistService = new ArtistService();
  }

  // 取得用戶資料
  getUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    const user = await this.userService.getUserById(userId);

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.json(user);
  };

  // 更新用戶資料
  updateUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    const { displayName } = req.body;

    if (displayName !== undefined && typeof displayName !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'DisplayName must be a string', 'displayName');
    }

    const user = await this.userService.updateUser(userId, {
      displayName,
    });

    res.json(user);
  };

  // ==================== 我的投稿（分頁） ====================

  getMySubmittedEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    if (!userId) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await this.eventService.getUserSubmittedEventsPaginated(
      userId,
      Number.isFinite(page) ? page : 1,
      Number.isFinite(limit) ? limit : 20
    );
    res.json(result);
  };

  getMySubmittedArtists = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    if (!userId) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await this.artistService.getUserSubmittedArtistsPaginated(
      userId,
      Number.isFinite(page) ? page : 1,
      Number.isFinite(limit) ? limit : 20
    );
    res.json(result);
  };

  // ==================== 收藏相關 ====================

  // 取得收藏列表
  getFavorites = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    const filters: FavoriteFilterParams = {
      sort: req.query.sort as 'favoritedAt' | 'startTime',
      sortOrder: req.query.sortOrder as 'asc' | 'desc',
      status: req.query.status as 'notEnded' | 'active' | 'upcoming' | 'ended' | 'all',
      artistIds: req.query.artistIds ? (req.query.artistIds as string).split(',') : undefined,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };

    const result = await this.userService.getFavorites(userId, filters);
    res.json(result);
  };

  // 新增收藏
  addFavorite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    const { eventId } = req.body;

    if (!eventId || typeof eventId !== 'string') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'eventId is required and must be a string',
        'eventId'
      );
    }

    const favorite = await this.userService.addFavorite(userId, eventId);
    res.status(201).json(favorite);
  };

  // 取消收藏
  removeFavorite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    const eventId = req.params.eventId as string;

    await this.userService.removeFavorite(userId, eventId);
    res.json({ message: 'Favorite removed successfully' });
  };

  // 檢查是否已收藏
  checkFavorite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.uid;
    const eventId = req.params.eventId as string;

    const isFavorited = await this.userService.isFavorited(userId, eventId);
    res.json({ isFavorited });
  };

}
