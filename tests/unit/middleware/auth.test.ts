import '../../../tests/mocks/firebase';
import { Request, Response, NextFunction } from 'express';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../../../src/middleware/auth';
import { mockAuth, mockCollection, createMockDocRef } from '../../mocks/firebase';

describe('Auth Middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockReq = {
      headers: {}
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    
    mockNext = jest.fn();
  });

  describe('authenticateToken', () => {
    it('應該成功驗證有效的 token', async () => {
      mockReq.headers = {
        authorization: 'Bearer valid-token'
      };

      mockAuth.verifyIdToken.mockResolvedValueOnce({
        uid: 'user-123',
        email: 'test@example.com'
      });

      const mockUserDoc = createMockDocRef();
      mockUserDoc.get.mockResolvedValue({
        data: () => ({ role: 'user' })
      });
      mockCollection.doc.mockReturnValue(mockUserDoc);

      await authenticateToken(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid-token');
      expect(mockReq.user).toEqual({
        uid: 'user-123',
        email: 'test@example.com',
        role: 'user'
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('應該拒絕沒有 token 的請求', async () => {
      mockReq.headers = {};

      await authenticateToken(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('應該拒絕無效的 token', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid-token'
      };

      mockAuth.verifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

      await authenticateToken(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('應該為沒有角色資料的用戶設定預設角色', async () => {
      mockReq.headers = {
        authorization: 'Bearer valid-token'
      };

      mockAuth.verifyIdToken.mockResolvedValueOnce({
        uid: 'user-123',
        email: 'test@example.com'
      });

      const mockUserDoc = createMockDocRef();
      mockUserDoc.get.mockResolvedValue({
        data: () => null // 沒有用戶資料
      });
      mockCollection.doc.mockReturnValue(mockUserDoc);

      await authenticateToken(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockReq.user).toEqual({
        uid: 'user-123',
        email: 'test@example.com',
        role: 'user' // 預設角色
      });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    it('應該允許管理員通過', () => {
      mockReq.user = {
        uid: 'admin-123',
        email: 'admin@example.com',
        role: 'admin'
      };

      requireAdmin(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('應該拒絕一般用戶', () => {
      mockReq.user = {
        uid: 'user-123',
        email: 'user@example.com',
        role: 'user'
      };

      requireAdmin(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('應該拒絕沒有用戶資訊的請求', () => {
      mockReq.user = undefined;

      requireAdmin(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});