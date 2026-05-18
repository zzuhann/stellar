import { Router } from 'express';
import { VenueController } from '../controllers/venueController';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { validateRequest, venueSchemas } from '../middleware/validation';

const router = Router();
const venueController = new VenueController();

router.post(
  '/',
  authenticateToken,
  requireAdmin,
  validateRequest({ body: venueSchemas.create }),
  venueController.createVenue
);
router.get('/', venueController.getVenues);
router.get('/admin/:id', authenticateToken, requireAdmin, venueController.getAdminVenueById);
router.get('/:id', venueController.getVenueById);
router.delete(
  '/admin/:id/permanent',
  authenticateToken,
  requireAdmin,
  venueController.permanentDeleteVenue
);
router.patch(
  '/:id',
  authenticateToken,
  requireAdmin,
  validateRequest({ body: venueSchemas.update }),
  venueController.updateVenue
);
router.delete('/:id', authenticateToken, requireAdmin, venueController.deleteVenue);

export default router;
