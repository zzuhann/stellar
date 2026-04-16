import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { EventService } from '../services/eventService';
import { EventFilterParams, MapDataParams, UpdateEventData } from '../models/types';
import { cache } from '../utils/cache';

export class EventController {
  private eventService: EventService;

  constructor() {
    this.eventService = new EventService();
  }

  // 取得活動列表（支援進階篩選和分頁）
  getActiveEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const filters: EventFilterParams = {
      search: req.query.search as string,
      artistId: req.query.artistId as string,
      status: req.query.status as 'all' | 'pending' | 'approved' | 'rejected',
      region: req.query.region as string,
      createdBy: req.query.createdBy as string,
      startTimeFrom: req.query.startTimeFrom as string,
      startTimeTo: req.query.startTimeTo as string,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      sortBy: req.query.sortBy as 'title' | 'startTime' | 'createdAt' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    };

    // 檢查權限：用戶只能查看自己的投稿或公開的資料
    if (filters.createdBy && req.user) {
      if (filters.createdBy !== req.user.uid && req.user.role !== 'admin') {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
    }

    // 如果沒有提供 status，預設為 'approved'（只顯示已審核通過的活動）
    if (!filters.status) {
      filters.status = 'approved';
    }

    // 如果有 checkFavorite=true 且用戶已登入，則傳遞 userId
    const checkFavorite = req.query.checkFavorite === 'true';
    const userId = checkFavorite && req.user ? req.user.uid : undefined;

    const result = await this.eventService.getEventsWithFilters(filters, userId);
    res.json(result);
  };

  // 取得待審核的活動（僅管理員）
  getPendingEvents = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    const events = await this.eventService.getPendingEvents();
    res.json(events);
  };

  // 取得單一活動詳情
  getEventById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = req.params.id as string;
    // 如果用戶已登入，則傳遞 userId 以取得收藏狀態
    const userId = req.user?.uid;
    const event = await this.eventService.getEventById(id, userId);

    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    res.json(event);
  };

  // 新增活動
  createEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const eventData = req.body;
    const userId = req.user?.uid;
    const userEmail = req.user?.email;

    // 驗證必填欄位
    const requiredFields = ['artistIds', 'title', 'location', 'datetime'];
    for (const field of requiredFields) {
      if (!eventData[field]) {
        res.status(400).json({ error: `${field} is required` });
        return;
      }
    }

    // 驗證 artistIds 是陣列且不為空
    if (!Array.isArray(eventData.artistIds) || eventData.artistIds.length === 0) {
      res.status(400).json({ error: 'artistIds must be a non-empty array' });
      return;
    }

    const event = await this.eventService.createEvent(eventData, userId, userEmail);
    res.status(201).json(event);
  };

  // 編輯活動
  updateEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const updateData: UpdateEventData = req.body;
      const userId = req.user?.uid;
      const userRole = req.user?.role;

      // 驗證時間資料格式（如果提供）
      if (updateData.datetime) {
        if (!updateData.datetime.start || !updateData.datetime.end) {
          res
            .status(400)
            .json({ error: 'Both start and end datetime are required when updating datetime' });
          return;
        }
      }

      const event = await this.eventService.updateEvent(id, updateData, userId, userRole);
      res.json(event);
    } catch (error) {
      console.error('Error updating event:', error);
      if (error instanceof Error) {
        if (error.message === 'Event not found') {
          res.status(404).json({ error: 'Event not found' });
        } else if (error.message === 'Permission denied') {
          res.status(403).json({ error: 'Permission denied' });
        } else {
          res.status(500).json({ error: 'Failed to update event' });
        }
      } else {
        res.status(500).json({ error: 'Failed to update event' });
      }
    }
  };

  // 審核活動（僅管理員）
  reviewEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { status, reason } = req.body; // 加入 reason 參數

    if (!['approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const event = await this.eventService.updateEventStatus(id, status, reason);
    res.json(event);
  };

  // 審核通過活動（僅管理員）
  approveEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const event = await this.eventService.updateEventStatus(id, 'approved');
    res.json(event);
  };

  // 拒絕活動（僅管理員）
  rejectEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { reason } = req.body; // 從 request body 取得拒絕原因
    const event = await this.eventService.updateEventStatus(id, 'rejected', reason);
    res.json(event);
  };

  // 批次審核活動（僅管理員）
  batchReviewEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { updates } = req.body;

      if (!Array.isArray(updates) || updates.length === 0) {
        res.status(400).json({ error: 'Updates array is required' });
        return;
      }

      // 驗證每個更新項目
      for (const update of updates) {
        if (!update.eventId || !update.status) {
          res.status(400).json({ error: 'Each update must have eventId and status' });
          return;
        }
        if (!['approved', 'rejected'].includes(update.status)) {
          res.status(400).json({ error: `Invalid status: ${update.status}` });
          return;
        }
      }

      const events = await this.eventService.batchUpdateEventStatus(updates);

      res.json(events);
    } catch (error) {
      console.error('Error batch reviewing events:', error);
      if (error instanceof Error) {
        if (error.message.includes('活動不存在')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Failed to batch review events' });
        }
      } else {
        res.status(500).json({ error: 'Failed to batch review events' });
      }
    }
  };

  // 刪除活動（僅管理員或活動創建者）
  deleteEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const userId = req.user?.uid;
    const userRole = req.user?.role;

    await this.eventService.deleteEvent(id, userId, userRole);
    res.json({ message: 'Event deleted successfully' });
  };

  // 重新送審活動
  resubmitEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const userId = req.user?.uid;

      const event = await this.eventService.resubmitEvent(id, userId);
      res.json(event);
    } catch (error) {
      console.error('Error resubmitting event:', error);
      const message = error instanceof Error ? error.message : 'Failed to resubmit event';
      res.status(400).json({ error: message });
    }
  };

  // 搜尋活動
  searchEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { query, artistName, location } = req.query;
    const events = await this.eventService.searchEvents({
      query: query as string,
      artistName: artistName as string,
      location: location as string,
    });
    res.json(events);
  };

  // 記錄活動瀏覽量
  recordView = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const forwarded = req.headers['x-forwarded-for'];
      const ip =
        (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ??
        req.ip ??
        'unknown';

      const dedupKey = `view_dedup:${ip}:${id}`;
      if (cache.get(dedupKey) !== null) {
        res.status(204).send();
        return;
      }

      await this.eventService.incrementViewCount(id);
      cache.set(dedupKey, true, 60);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes('No document to update')) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }
      console.error('Error recording view:', error);
      res.status(500).json({ error: 'Failed to record view' });
    }
  };

  // 取得熱門活動排行
  getTrendingEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string), 20) : 10;
    const events = await this.eventService.getTrendingEvents(limit);
    res.json({ events, total: events.length });
  };

  // 新增：地圖資料 API
  getMapData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const params: MapDataParams = {
      status: req.query.status as 'active' | 'upcoming' | 'all',
      bounds: req.query.bounds as string,
      zoom: req.query.zoom ? parseInt(req.query.zoom as string) : undefined,
      // 新增篩選參數
      search: req.query.search as string,
      artistId: req.query.artistId as string,
      region: req.query.region as string,
    };

    const result = await this.eventService.getMapData(params);
    res.json(result);
  };
}
