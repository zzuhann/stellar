import { Router } from 'express';
import { VenueController } from '../controllers/venueController';
import { authenticateToken, optionalAuthenticate, requireAdmin } from '../middleware/auth';
import { venueDetailLimiter, venuesListLimiter } from '../middleware/rateLimiters';
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
router.get('/', venuesListLimiter, optionalAuthenticate, venueController.getVenues);

// Batch routes must come before /:id to avoid being matched as an id param
router.patch(
  '/batch-review',
  authenticateToken,
  requireAdmin,
  validateRequest({ body: venueSchemas.batchReview }),
  venueController.batchReview
);
router.patch(
  '/batch-status',
  authenticateToken,
  requireAdmin,
  validateRequest({ body: venueSchemas.batchStatus }),
  venueController.batchStatus
);

router.get('/admin/:id', authenticateToken, requireAdmin, venueController.getAdminVenueById);
router.get('/:id', venueDetailLimiter, optionalAuthenticate, venueController.getVenueById);
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
