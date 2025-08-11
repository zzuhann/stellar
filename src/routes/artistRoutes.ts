import { Router } from 'express';
import { ArtistController } from '../controllers/artistController';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { validateRequest, artistSchemas } from '../middleware/validation';

const router = Router();
const artistController = new ArtistController();

// 公開路由
router.get('/', validateRequest({ query: artistSchemas.query }), artistController.getAllArtists);
router.get(
  '/:id',
  validateRequest({ params: artistSchemas.params }),
  artistController.getArtistById
);

// 需要登入的路由
router.post(
  '/',
  authenticateToken,
  validateRequest({ body: artistSchemas.create }),
  artistController.createArtist
);
router.put(
  '/:id',
  authenticateToken,
  validateRequest({
    params: artistSchemas.params,
    body: artistSchemas.update,
  }),
  artistController.updateArtist
);
router.patch(
  '/:id/resubmit',
  authenticateToken,
  validateRequest({ params: artistSchemas.params }),
  artistController.resubmitArtist
);

// 管理員專用路由
router.get('/pending', authenticateToken, requireAdmin, artistController.getPendingArtists);
router.patch(
  '/:id/review',
  authenticateToken,
  requireAdmin,
  validateRequest({
    params: artistSchemas.params,
    body: artistSchemas.review,
  }),
  artistController.reviewArtist
);
router.put(
  '/:id/approve',
  authenticateToken,
  requireAdmin,
  validateRequest({ params: artistSchemas.params }),
  artistController.approveArtist
);
router.put(
  '/:id/reject',
  authenticateToken,
  requireAdmin,
  validateRequest({
    params: artistSchemas.params,
    body: artistSchemas.reject,
  }),
  artistController.rejectArtist
);
router.delete(
  '/:id',
  authenticateToken,
  requireAdmin,
  validateRequest({ params: artistSchemas.params }),
  artistController.deleteArtist
);

export default router;
