import { Router } from 'express';
import { VenueController } from '../controllers/venueController';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { validateRequest, venueSchemas } from '../middleware/validation';

const router = Router();
const venueController = new VenueController();

router.get('/', venueController.getVenues);
router.get('/:id', venueController.getVenueById);
router.patch(
  '/:id',
  authenticateToken,
  requireAdmin,
  validateRequest({ body: venueSchemas.update }),
  venueController.updateVenue
);

export default router;
