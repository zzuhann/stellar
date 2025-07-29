import '../../tests/mocks/firebase';
import request from 'supertest';
import app from '../../src/app';
import { mockCollection, createMockDocRef } from '../mocks/firebase';

describe('Artists API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/artists', () => {
    it('應該回傳已審核的藝人列表', async () => {
      const mockArtists = [
        {
          id: 'artist-1',
          stageName: 'IU',
          realName: '李知恩',
          status: 'approved',
        },
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockArtists.map(artist => ({
          id: artist.id,
          data: () => artist,
        })),
      });

      const response = await request(app).get('/api/artists').expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].stageName).toBe('IU');
    });

    it('應該處理空的藝人列表', async () => {
      mockCollection.get.mockResolvedValueOnce({
        docs: [],
      });

      const response = await request(app).get('/api/artists').expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('應該處理資料庫錯誤', async () => {
      mockCollection.get.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app).get('/api/artists').expect(500);

      expect(response.body.error).toBe('Failed to fetch artists');
    });
  });

  describe('POST /api/artists', () => {
    it('應該成功建立新藝人（需要認證）', async () => {
      const newArtist = {
        stageName: 'NewStar',
        realName: '新星',
        birthday: '1990-01-01',
      };

      // Mock 認證成功
      const mockAuth = require('../mocks/firebase').mockAuth;
      mockAuth.verifyIdToken.mockResolvedValueOnce({
        uid: 'user-123',
        email: 'test@example.com',
      });

      // Mock Firestore 操作
      mockCollection.get.mockResolvedValueOnce({ empty: true }); // 檢查重複
      mockCollection.add.mockResolvedValueOnce({ id: 'new-artist-id' });

      // Mock 用戶資料查詢
      const mockUserDoc = createMockDocRef();
      mockUserDoc.get.mockResolvedValue({
        data: () => ({ role: 'user' }),
      });
      mockCollection.doc.mockReturnValue(mockUserDoc);

      const response = await request(app)
        .post('/api/artists')
        .set('Authorization', 'Bearer mock-token')
        .send(newArtist)
        .expect(201);

      expect(response.body.stageName).toBe('NewStar');
      expect(response.body.status).toBe('pending');
    });

    it('應該拒絕未認證的請求', async () => {
      const newArtist = {
        stageName: 'NewStar',
      };

      const response = await request(app).post('/api/artists').send(newArtist).expect(401);

      expect(response.body.error).toBe('Access token required');
    });

    it('應該驗證必填欄位', async () => {
      // Mock 認證成功
      const mockAuth = require('../mocks/firebase').mockAuth;
      mockAuth.verifyIdToken.mockResolvedValueOnce({
        uid: 'user-123',
        email: 'test@example.com',
      });

      const mockUserDoc = createMockDocRef();
      mockUserDoc.get.mockResolvedValue({
        data: () => ({ role: 'user' }),
      });
      mockCollection.doc.mockReturnValue(mockUserDoc);

      const response = await request(app)
        .post('/api/artists')
        .set('Authorization', 'Bearer mock-token')
        .send({}) // 空的請求體
        .expect(400);

      expect(response.body.error).toBe('Stage name is required');
    });
  });
});
