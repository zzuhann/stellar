import { Router } from 'express';
import { ArtistController } from '../controllers/artistController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const artistController = new ArtistController();

// 公開路由
router.get('/', artistController.getAllArtists);

// 需要登入的路由
router.post('/', authenticateToken, artistController.createArtist);

// 管理員專用路由
router.get('/pending', authenticateToken, requireAdmin, artistController.getPendingArtists);
router.patch('/:id/review', authenticateToken, requireAdmin, artistController.reviewArtist);
router.put('/:id/approve', authenticateToken, requireAdmin, artistController.approveArtist);
router.put('/:id/reject', authenticateToken, requireAdmin, artistController.rejectArtist);
router.delete('/:id', authenticateToken, requireAdmin, artistController.deleteArtist);

export default router;
