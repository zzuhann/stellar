import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { UserService } from '../services/userService';
import { FavoriteFilterParams } from '../models/types';

export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  // 取得用戶資料
  getUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const user = await this.userService.getUserById(userId);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(user);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  };

  // 更新用戶資料
  updateUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const { displayName } = req.body;

      if (displayName !== undefined && typeof displayName !== 'string') {
        res.status(400).json({ error: 'DisplayName must be a string' });
        return;
      }

      const user = await this.userService.updateUser(userId, {
        displayName,
      });

      res.json(user);
    } catch (error) {
      console.error('Error updating user profile:', error);
      const message = error instanceof Error ? error.message : 'Failed to update user profile';
      res.status(400).json({ error: message });
    }
  };

  // ==================== 收藏相關 ====================

  // 取得收藏列表
  getFavorites = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
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
    } catch (error) {
      console.error('Error fetching favorites:', error);
      res.status(500).json({ error: 'Failed to fetch favorites' });
    }
  };

  // 新增收藏
  addFavorite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const { eventId } = req.body;

      if (!eventId || typeof eventId !== 'string') {
        res.status(400).json({ error: 'eventId is required and must be a string' });
        return;
      }

      const favorite = await this.userService.addFavorite(userId, eventId);
      res.status(201).json(favorite);
    } catch (error) {
      console.error('Error adding favorite:', error);
      const message = error instanceof Error ? error.message : 'Failed to add favorite';
      res.status(400).json({ error: message });
    }
  };

  // 取消收藏
  removeFavorite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const { eventId } = req.params;

      await this.userService.removeFavorite(userId, eventId);
      res.json({ message: 'Favorite removed successfully' });
    } catch (error) {
      console.error('Error removing favorite:', error);
      const message = error instanceof Error ? error.message : 'Failed to remove favorite';
      res.status(400).json({ error: message });
    }
  };

  // 檢查是否已收藏
  checkFavorite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const { eventId } = req.params;

      const isFavorited = await this.userService.isFavorited(userId, eventId);
      res.json({ isFavorited });
    } catch (error) {
      console.error('Error checking favorite:', error);
      res.status(500).json({ error: 'Failed to check favorite status' });
    }
  };
}
