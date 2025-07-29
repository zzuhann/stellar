import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { EventService } from '../services/eventService';

export class EventController {
  private eventService: EventService;

  constructor() {
    this.eventService = new EventService();
  }

  // 獲取所有已審核且未過期的活動
  getActiveEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const events = await this.eventService.getActiveEvents();
      res.json(events);
    } catch (error) {
      console.error('Error fetching active events:', error);
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
        location: location as string
      });
      res.json(events);
    } catch (error) {
      console.error('Error searching events:', error);
      res.status(500).json({ error: 'Failed to search events' });
    }
  };
}