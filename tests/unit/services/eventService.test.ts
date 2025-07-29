import '../../../tests/mocks/firebase';
import { EventService } from '../../../src/services/eventService';
import { mockCollection, mockTimestamp, createMockDocRef } from '../../mocks/firebase';

describe('EventService', () => {
  let eventService: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    eventService = new EventService();
  });

  describe('getActiveEvents', () => {
    it('應該回傳進行中的活動', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 明天
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 昨天

      const mockEvents = [
        {
          id: 'event-1',
          title: '進行中活動',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(new Date()),
            end: mockTimestamp.fromDate(futureDate)
          }
        },
        {
          id: 'event-2', 
          title: '已結束活動',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(pastDate),
            end: mockTimestamp.fromDate(pastDate)
          }
        }
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockEvents.map(event => ({
          id: event.id,
          data: () => event
        }))
      });

      const result = await eventService.getActiveEvents();

      expect(mockCollection.where).toHaveBeenCalledWith('status', '==', 'approved');
      expect(mockCollection.where).toHaveBeenCalledWith('isDeleted', '==', false);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('進行中活動');
    });

    it('應該按開始時間排序', async () => {
      const futureDate1 = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const futureDate2 = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const mockEvents = [
        {
          id: 'event-2',
          title: '第二個活動',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(futureDate2),
            end: mockTimestamp.fromDate(futureDate2)
          }
        },
        {
          id: 'event-1',
          title: '第一個活動', 
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(futureDate1),
            end: mockTimestamp.fromDate(futureDate1)
          }
        }
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockEvents.map(event => ({
          id: event.id,
          data: () => event
        }))
      });

      const result = await eventService.getActiveEvents();

      expect(result[0].title).toBe('第一個活動');
      expect(result[1].title).toBe('第二個活動');
    });
  });

  describe('createEvent', () => {
    it('應該成功建立新活動', async () => {
      const eventData = {
        artistId: 'artist-123',
        title: '測試活動',
        description: '測試描述',
        location: {
          address: '台北市信義區',
          coordinates: { lat: 25.0, lng: 121.0 }
        },
        datetime: {
          start: new Date(),
          end: new Date(Date.now() + 24 * 60 * 60 * 1000)
        },
        socialMedia: {
          instagram: 'https://instagram.com/test'
        }
      };

      // Mock 藝人存在且已審核
      const mockArtistDoc = {
        exists: true,
        data: () => ({ status: 'approved' })
      };

      // Mock db.collection('artists').doc().get()
      const mockArtistCollection = {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(mockArtistDoc)
        }))
      };

      // 需要 mock db.collection('artists')
      const originalCollection = mockCollection;
      const dbMock = {
        collection: jest.fn((name: string) => {
          if (name === 'artists') {
            return mockArtistCollection;
          }
          return originalCollection;
        })
      };

      // 暫時替換 db mock
      jest.doMock('../../../src/config/firebase', () => ({
        db: dbMock,
        hasFirebaseConfig: true
      }));

      mockCollection.add.mockResolvedValueOnce({ id: 'new-event-id' });

      const result = await eventService.createEvent(eventData, 'user-123');

      expect(result.id).toBe('new-event-id');
      expect(result.title).toBe('測試活動');
      expect(result.status).toBe('pending');
    });
  });

  describe('deleteEvent', () => {
    it('應該成功軟刪除活動', async () => {
      const eventId = 'event-123';
      const userId = 'user-123';

      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({
        exists: true,
        data: () => ({
          title: '測試活動',
          createdBy: userId,
          isDeleted: false
        })
      });

      mockCollection.doc.mockReturnValue(mockDocRef);

      await eventService.deleteEvent(eventId, userId, 'user');

      expect(mockDocRef.update).toHaveBeenCalledWith({
        isDeleted: true,
        updatedAt: expect.any(Object)
      });
    });

    it('應該拒絕刪除他人的活動', async () => {
      const eventId = 'event-123';
      const userId = 'user-123';
      const otherUserId = 'other-user';

      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({
        exists: true,
        data: () => ({
          title: '測試活動',
          createdBy: otherUserId,
          isDeleted: false
        })
      });

      mockCollection.doc.mockReturnValue(mockDocRef);

      await expect(
        eventService.deleteEvent(eventId, userId, 'user')
      ).rejects.toThrow('Permission denied');
    });

    it('應該允許管理員刪除任何活動', async () => {
      const eventId = 'event-123';
      const adminId = 'admin-123';
      const otherUserId = 'other-user';

      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({
        exists: true,
        data: () => ({
          title: '測試活動',
          createdBy: otherUserId,
          isDeleted: false
        })
      });

      mockCollection.doc.mockReturnValue(mockDocRef);

      await eventService.deleteEvent(eventId, adminId, 'admin');

      expect(mockDocRef.update).toHaveBeenCalledWith({
        isDeleted: true,
        updatedAt: expect.any(Object)
      });
    });
  });
});