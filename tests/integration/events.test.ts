import '../../tests/mocks/firebase';
import request from 'supertest';
import app from '../../src/app';
import { mockCollection, mockTimestamp, createMockDocRef } from '../mocks/firebase';

describe('Events API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/events', () => {
    it('應該回傳進行中的活動', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      const mockEvents = [
        {
          id: 'event-1',
          title: 'IU 生日應援咖啡',
          artistId: 'artist-1',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(new Date()),
            end: mockTimestamp.fromDate(futureDate)
          },
          location: {
            address: '台北市信義區',
            coordinates: { lat: 25.0, lng: 121.0 }
          }
        }
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockEvents.map(event => ({
          id: event.id,
          data: () => event
        }))
      });

      const response = await request(app)
        .get('/api/events')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('IU 生日應援咖啡');
    });

    it('應該過濾掉已結束的活動', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const mockEvents = [
        {
          id: 'event-1',
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

      const response = await request(app)
        .get('/api/events')
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/events/:id', () => {
    it('應該回傳特定活動的詳細資訊', async () => {
      const mockEvent = {
        id: 'event-123',
        title: 'IU 生日應援咖啡',
        description: '慶祝 IU 生日',
        isDeleted: false
      };

      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({
        exists: true,
        id: mockEvent.id,
        data: () => mockEvent
      });

      mockCollection.doc.mockReturnValue(mockDocRef);

      const response = await request(app)
        .get('/api/events/event-123')
        .expect(200);

      expect(response.body.title).toBe('IU 生日應援咖啡');
    });

    it('應該回傳 404 當活動不存在', async () => {
      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({
        exists: false
      });

      mockCollection.doc.mockReturnValue(mockDocRef);

      const response = await request(app)
        .get('/api/events/non-existent')
        .expect(404);

      expect(response.body.error).toBe('Event not found');
    });
  });

  describe('GET /api/events/search', () => {
    it('應該根據查詢參數搜尋活動', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          title: 'IU 生日應援咖啡',
          description: '慶祝 IU 生日的活動',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(new Date()),
            end: mockTimestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
          },
          location: {
            address: '台北市信義區忠孝東路'
          }
        },
        {
          id: 'event-2',
          title: 'BTS 應援活動',
          description: 'BTS 相關活動',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(new Date()),
            end: mockTimestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
          },
          location: {
            address: '台北市大安區'
          }
        }
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockEvents.map(event => ({
          id: event.id,
          data: () => event
        }))
      });

      const response = await request(app)
        .get('/api/events/search?query=IU')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('IU 生日應援咖啡');
    });

    it('應該根據地點搜尋活動', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          title: '信義區活動',
          status: 'approved',
          isDeleted: false,
          datetime: {
            start: mockTimestamp.fromDate(new Date()),
            end: mockTimestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
          },
          location: {
            address: '台北市信義區忠孝東路'
          }
        }
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockEvents.map(event => ({
          id: event.id,
          data: () => event
        }))
      });

      const response = await request(app)
        .get('/api/events/search?location=信義區')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('信義區活動');
    });
  });
});