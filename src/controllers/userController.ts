import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { UserService } from '../services/userService';
import { NotificationService } from '../services/notificationService';
import { NotificationFilterParams, FavoriteFilterParams } from '../models/types';

export class UserController {
  private userService: UserService;
  private notificationService: NotificationService;

  constructor() {
    this.userService = new UserService();
    this.notificationService = new NotificationService();
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

  // 取得通知列表
  getNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const filters: NotificationFilterParams = {
        isRead:
          req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined,
        type: req.query.type as NotificationFilterParams['type'],
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      };

      const result = await this.notificationService.getUserNotifications(userId, filters);
      res.json(result);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  };

  // 標記通知為已讀
  markNotificationAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user?.uid;

      const notification = await this.notificationService.markAsRead(id, userId);
      res.json(notification);
    } catch (error) {
      console.error('Error marking notification as read:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to mark notification as read';
      res.status(400).json({ error: message });
    }
  };

  // 批量標記為已讀
  markMultipleAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { notificationIds } = req.body;
      const userId = req.user?.uid;

      if (!Array.isArray(notificationIds)) {
        res.status(400).json({ error: 'notificationIds must be an array' });
        return;
      }

      await this.notificationService.markMultipleAsRead(notificationIds, userId);
      res.json({ message: 'Notifications marked as read successfully' });
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
  };

  // 刪除通知
  deleteNotification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user?.uid;

      await this.notificationService.deleteNotification(id, userId);
      res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
      console.error('Error deleting notification:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete notification';
      res.status(400).json({ error: message });
    }
  };

  // 取得未讀通知數量
  getUnreadCount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.uid;
      const count = await this.notificationService.getUnreadCount(userId);
      res.json({ unreadCount: count });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ error: 'Failed to fetch unread count' });
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
