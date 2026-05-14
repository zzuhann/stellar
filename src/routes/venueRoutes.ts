import { Router } from 'express';
import { VenueController } from '../controllers/venueController';

const router = Router();
const venueController = new VenueController();

router.get('/', venueController.getVenues);

export default router;
