import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { ArtistService } from '../services/artistService';
import { ArtistFilterParams } from '../models/types';

export class ArtistController {
  private artistService: ArtistService;

  constructor() {
    this.artistService = new ArtistService();
  }

  // 獲取藝人列表（支援進階篩選）
  getAllArtists = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        status,
        createdBy,
        birthdayStartDate,
        birthdayEndDate,
        search,
        includeStats,
        sortBy,
        sortOrder,
      } = req.query;

      // 建構篩選參數
      const filters: ArtistFilterParams = {
        status: status as 'approved' | 'pending' | 'rejected' | undefined,
        createdBy: createdBy as string | undefined,
        search: search as string | undefined,
        sortBy: sortBy as 'stageName' | 'coffeeEventCount' | 'createdAt' | undefined,
        sortOrder: sortOrder as 'asc' | 'desc' | undefined,
      };

      // 處理生日週篩選
      if (birthdayStartDate && birthdayEndDate) {
        filters.birthdayWeek = {
          startDate: birthdayStartDate as string,
          endDate: birthdayEndDate as string,
        };
      }

      // 移除狀態查看權限限制，任何人都可以查看各種狀態
      // 權限控制改在審核動作時進行檢查

      // 檢查權限：用戶只能查看自己的投稿或公開的資料
      if (filters.createdBy && req.user) {
        if (filters.createdBy !== req.user.uid && req.user.role !== 'admin') {
          res.status(403).json({ error: 'Permission denied' });
          return;
        }
      }

      // 根據是否需要統計資料選擇不同的服務方法
      if (includeStats === 'true') {
        const artists = await this.artistService.getArtistsWithStats(filters);
        res.json(artists);
      } else {
        const artists = await this.artistService.getArtistsWithFilters(filters);
        res.json(artists);
      }
    } catch (error) {
      console.error('Error fetching artists:', error);
      res.status(500).json({ error: 'Failed to fetch artists' });
    }
  };

  // 獲取待審核的藝人（僅管理員）
  getPendingArtists = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const artists = await this.artistService.getPendingArtists();
      res.json(artists);
    } catch (error) {
      console.error('Error fetching pending artists:', error);
      res.status(500).json({ error: 'Failed to fetch pending artists' });
    }
  };

  // 新增藝人
  createArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { stageName, stageNameZh, groupNames, realName, birthday, profileImage } = req.body;
      const userId = req.user!.uid;

      if (!stageName) {
        res.status(400).json({ error: 'Stage name is required' });
        return;
      }

      const artist = await this.artistService.createArtist(
        {
          stageName,
          stageNameZh,
          groupNames,
          realName,
          birthday,
          profileImage,
        },
        userId
      );

      res.status(201).json(artist);
    } catch (error) {
      console.error('Error creating artist:', error);
      res.status(500).json({ error: 'Failed to create artist' });
    }
  };

  // 審核藝人（僅管理員）
  reviewArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status, reason, adminUpdate } = req.body;

      if (!['approved', 'rejected', 'exists'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      const artist = await this.artistService.updateArtistStatus(id, status, reason, adminUpdate);
      res.json(artist);
    } catch (error) {
      console.error('Error reviewing artist:', error);
      res.status(500).json({ error: 'Failed to review artist' });
    }
  };

  // 審核通過藝人（僅管理員）
  approveArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { adminUpdate } = req.body; // 支援管理員更新團名
      const artist = await this.artistService.updateArtistStatus(
        id,
        'approved',
        undefined,
        adminUpdate
      );
      res.json(artist);
    } catch (error) {
      console.error('Error approving artist:', error);
      res.status(500).json({ error: 'Failed to approve artist' });
    }
  };

  // 批次審核藝人（僅管理員）
  batchReviewArtists = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { artistIds, status, reason, adminUpdate } = req.body;

      if (!Array.isArray(artistIds) || artistIds.length === 0) {
        res.status(400).json({ error: 'Artist IDs array is required' });
        return;
      }

      if (!['approved', 'rejected', 'exists'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      const artists = await this.artistService.batchUpdateArtistStatus(
        artistIds,
        status,
        reason,
        adminUpdate
      );

      res.json(artists);
    } catch (error) {
      console.error('Error batch reviewing artists:', error);
      res.status(500).json({ error: 'Failed to batch review artists' });
    }
  };

  // 拒絕藝人（僅管理員）
  rejectArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { reason } = req.body; // 從 request body 取得拒絕原因
      const artist = await this.artistService.updateArtistStatus(id, 'rejected', reason);
      res.json(artist);
    } catch (error) {
      console.error('Error rejecting artist:', error);
      res.status(500).json({ error: 'Failed to reject artist' });
    }
  };

  // 獲取單一藝人詳情
  getArtistById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const artist = await this.artistService.getArtistById(id);

      if (!artist) {
        res.status(404).json({ error: 'Artist not found' });
        return;
      }

      res.json(artist);
    } catch (error) {
      console.error('Error fetching artist:', error);
      res.status(500).json({ error: 'Failed to fetch artist' });
    }
  };

  // 編輯藝人
  updateArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { stageName, stageNameZh, groupNames, realName, birthday, profileImage } = req.body;
      const userId = req.user!.uid;

      const artist = await this.artistService.updateArtist(
        id,
        {
          stageName,
          stageNameZh,
          groupNames,
          realName,
          birthday,
          profileImage,
        },
        userId
      );

      res.json(artist);
    } catch (error) {
      console.error('Error updating artist:', error);
      const message = error instanceof Error ? error.message : 'Failed to update artist';
      res.status(400).json({ error: message });
    }
  };

  // 重新送審藝人
  resubmitArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.uid;

      const artist = await this.artistService.resubmitArtist(id, userId);
      res.json(artist);
    } catch (error) {
      console.error('Error resubmitting artist:', error);
      const message = error instanceof Error ? error.message : 'Failed to resubmit artist';
      res.status(400).json({ error: message });
    }
  };

  // 刪除藝人（僅管理員）
  deleteArtist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await this.artistService.deleteArtist(id);
      res.json({ message: 'Artist deleted successfully' });
    } catch (error) {
      console.error('Error deleting artist:', error);
      res.status(500).json({ error: 'Failed to delete artist' });
    }
  };
}
