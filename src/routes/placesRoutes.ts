import { Router } from 'express';
import { PlacesController } from '../controllers/placesController';

const router = Router();
const placesController = new PlacesController();

// Google Places API 代理端點
router.post('/autocomplete', (req, res) => void placesController.autocomplete(req, res));
router.get('/details/:placeId', (req, res) => void placesController.placeDetails(req, res));

export default router;
