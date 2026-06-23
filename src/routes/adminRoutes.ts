import { Router } from 'express';
import { AdminController } from '../controllers/adminController';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { validateRequest, adminSchemas } from '../middleware/validation';

const router = Router();
const adminController = new AdminController();

router.get(
  '/events',
  authenticateToken,
  requireAdmin,
  validateRequest({ query: adminSchemas.listQuery }),
  adminController.getEvents
);
router.get(
  '/artists',
  authenticateToken,
  requireAdmin,
  validateRequest({ query: adminSchemas.listQuery }),
  adminController.getArtists
);
router.get(
  '/venues',
  authenticateToken,
  requireAdmin,
  validateRequest({ query: adminSchemas.venueListQuery }),
  adminController.getVenues
);
router.delete(
  '/artists/batch',
  authenticateToken,
  requireAdmin,
  validateRequest({ body: adminSchemas.batchDeleteArtists }),
  adminController.deleteArtistsBatch
);

export default router;
