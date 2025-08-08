import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { UserService } from '../services/userService';
import { NotificationService } from '../services/notificationService';
import { NotificationFilterParams } from '../models/types';

export class UserController {
  private userService: UserService;
  private notificationService: NotificationService;

  constructor() {
    this.userService = new UserService();
    this.notificationService = new NotificationService();
  }

  // 獲取用戶資料
  getUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.uid;
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
      const userId = req.user!.uid;
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

  // 獲取通知列表
  getNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.uid;
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
      const userId = req.user!.uid;

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
      const userId = req.user!.uid;

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
      const userId = req.user!.uid;

      await this.notificationService.deleteNotification(id, userId);
      res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
      console.error('Error deleting notification:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete notification';
      res.status(400).json({ error: message });
    }
  };

  // 獲取未讀通知數量
  getUnreadCount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.uid;
      const count = await this.notificationService.getUnreadCount(userId);
      res.json({ unreadCount: count });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ error: 'Failed to fetch unread count' });
    }
  };
}
