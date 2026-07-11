import { Router } from 'express';
import { VenueController } from '../controllers/venueController';
import { ImageController } from '../controllers/imageController';
import { PlacesController } from '../controllers/placesController';
import { uploadSingle } from '../middleware/upload';
import { validateRequest, venueSchemas } from '../middleware/validation';
import {
  venueSubmissionImageLimiter,
  venueSubmissionLimiter,
  venueSubmissionPlacesLimiter,
} from '../middleware/rateLimiters';

const router = Router();
const venueController = new VenueController();
const imageController = new ImageController();
const placesController = new PlacesController();

router.post(
  '/',
  venueSubmissionLimiter,
  validateRequest({ body: venueSchemas.create }),
  venueController.createVenueSubmission
);
router.post('/images', venueSubmissionImageLimiter, uploadSingle, imageController.uploadImage);
router.post('/places/autocomplete', venueSubmissionPlacesLimiter, placesController.autocomplete);
router.get('/places/:placeId', venueSubmissionPlacesLimiter, placesController.placeDetails);

export default router;
