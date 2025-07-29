import '../../../tests/mocks/firebase';
import { ArtistService } from '../../../src/services/artistService';
import { mockCollection, createMockDocRef } from '../../mocks/firebase';

describe('ArtistService', () => {
  let artistService: ArtistService;

  beforeEach(() => {
    jest.clearAllMocks();
    artistService = new ArtistService();
  });

  describe('getApprovedArtists', () => {
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

      const result = await artistService.getApprovedArtists();

      expect(mockCollection.where).toHaveBeenCalledWith('status', '==', 'approved');
      expect(result).toHaveLength(1);
      expect(result[0].stageName).toBe('IU');
    });

    it('應該按藝名排序', async () => {
      const mockArtists = [
        { id: '1', stageName: 'Zara', status: 'approved' },
        { id: '2', stageName: 'Amy', status: 'approved' },
      ];

      mockCollection.get.mockResolvedValueOnce({
        docs: mockArtists.map(artist => ({
          id: artist.id,
          data: () => artist,
        })),
      });

      const result = await artistService.getApprovedArtists();

      expect(result[0].stageName).toBe('Amy');
      expect(result[1].stageName).toBe('Zara');
    });
  });

  describe('createArtist', () => {
    it('應該成功建立新藝人', async () => {
      const newArtistData = {
        stageName: 'NewStar',
        realName: '新星',
        birthday: '1990-01-01',
      };

      // Mock 檢查重複名稱的查詢回傳空結果
      mockCollection.get.mockResolvedValueOnce({ empty: true });
      mockCollection.add.mockResolvedValueOnce({ id: 'new-artist-id' });

      const result = await artistService.createArtist(newArtistData, 'user-123');

      expect(mockCollection.where).toHaveBeenCalledWith('stageName', '==', 'NewStar');
      expect(mockCollection.add).toHaveBeenCalled();
      expect(result.id).toBe('new-artist-id');
      expect(result.stageName).toBe('NewStar');
      expect(result.status).toBe('pending');
    });

    it('應該拒絕重複的藝名', async () => {
      const newArtistData = {
        stageName: 'ExistingArtist',
      };

      // Mock 檢查重複名稱的查詢回傳有結果
      mockCollection.get.mockResolvedValueOnce({ empty: false });

      await expect(artistService.createArtist(newArtistData, 'user-123')).rejects.toThrow(
        'Artist with this stage name already exists'
      );
    });
  });

  describe('updateArtistStatus', () => {
    it('應該成功更新藝人狀態', async () => {
      const artistId = 'artist-123';
      const newStatus = 'approved';

      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({
        exists: true,
        data: () => ({ stageName: 'Test Artist', status: 'pending' }),
      });

      mockCollection.doc.mockReturnValue(mockDocRef);

      // Mock 第二次調用 get() 來取得更新後的文件
      mockDocRef.get
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ stageName: 'Test Artist', status: 'pending' }),
        })
        .mockResolvedValueOnce({
          id: artistId,
          data: () => ({ stageName: 'Test Artist', status: newStatus }),
        });

      const result = await artistService.updateArtistStatus(artistId, newStatus);

      expect(mockDocRef.update).toHaveBeenCalledWith({
        status: newStatus,
        updatedAt: expect.any(Object),
      });
      expect(result.status).toBe(newStatus);
    });

    it('應該在藝人不存在時拋出錯誤', async () => {
      const mockDocRef = createMockDocRef();
      mockDocRef.get.mockResolvedValue({ exists: false });

      mockCollection.doc.mockReturnValue(mockDocRef);

      await expect(artistService.updateArtistStatus('non-existent', 'approved')).rejects.toThrow(
        'Artist not found'
      );
    });
  });
});
