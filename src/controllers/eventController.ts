import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { EventService } from '../services/eventService';
import { EventFilterParams, MapDataParams } from '../models/types';

export class EventController {
  private eventService: EventService;

  constructor() {
    this.eventService = new EventService();
  }

  // 獲取活動列表（支援進階篩選和分頁）
  getActiveEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const filters: EventFilterParams = {
        search: req.query.search as string,
        artistId: req.query.artistId as string,
        status: req.query.status as 'all' | 'active' | 'upcoming' | 'ended',
        region: req.query.region as string,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      };

      // 如果沒有提供 status，預設為 'active'（只顯示進行中的活動）
      if (!filters.status) {
        filters.status = 'active';
      }

      const result = await this.eventService.getEventsWithFilters(filters);
      res.json(result);
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  };

  // 獲取待審核的活動（僅管理員）
  getPendingEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const events = await this.eventService.getPendingEvents();
      res.json(events);
    } catch (error) {
      console.error('Error fetching pending events:', error);
      res.status(500).json({ error: 'Failed to fetch pending events' });
    }
  };

  // 獲取單一活動詳情
  getEventById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const event = await this.eventService.getEventById(id);

      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      res.json(event);
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ error: 'Failed to fetch event' });
    }
  };

  // 新增活動
  createEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const eventData = req.body;
      const userId = req.user!.uid;

      // 驗證必填欄位
      const requiredFields = ['artistId', 'title', 'description', 'location', 'datetime'];
      for (const field of requiredFields) {
        if (!eventData[field]) {
          res.status(400).json({ error: `${field} is required` });
          return;
        }
      }

      const event = await this.eventService.createEvent(eventData, userId);
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  };

  // 審核活動（僅管理員）
  reviewEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!['approved', 'rejected'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      const event = await this.eventService.updateEventStatus(id, status);
      res.json(event);
    } catch (error) {
      console.error('Error reviewing event:', error);
      res.status(500).json({ error: 'Failed to review event' });
    }
  };

  // 審核通過活動（僅管理員）
  approveEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const event = await this.eventService.updateEventStatus(id, 'approved');
      res.json(event);
    } catch (error) {
      console.error('Error approving event:', error);
      res.status(500).json({ error: 'Failed to approve event' });
    }
  };

  // 拒絕活動（僅管理員）
  rejectEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const event = await this.eventService.updateEventStatus(id, 'rejected');
      res.json(event);
    } catch (error) {
      console.error('Error rejecting event:', error);
      res.status(500).json({ error: 'Failed to reject event' });
    }
  };

  // 刪除活動（僅管理員或活動創建者）
  deleteEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.uid;
      const userRole = req.user!.role;

      await this.eventService.deleteEvent(id, userId, userRole);
      res.json({ message: 'Event deleted successfully' });
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  };

  // 搜尋活動
  searchEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { query, artistName, location } = req.query;
      const events = await this.eventService.searchEvents({
        query: query as string,
        artistName: artistName as string,
        location: location as string,
      });
      res.json(events);
    } catch (error) {
      console.error('Error searching events:', error);
      res.status(500).json({ error: 'Failed to search events' });
    }
  };

  // 新增：地圖資料 API
  getMapData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
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
    } catch (error) {
      console.error('Error fetching map data:', error);
      res.status(500).json({ error: 'Failed to fetch map data' });
    }
  };
}
