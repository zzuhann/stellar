import { Router } from 'express';
import { PlacesController } from '../controllers/placesController';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const placesController = new PlacesController();

// Google Places API 代理端點（需要登入，防止未授權使用 Google API 配額）
router.post('/autocomplete', authenticateToken, (req, res) =>
  placesController.autocomplete(req, res)
);
router.get('/details/:placeId', authenticateToken, (req, res) =>
  placesController.placeDetails(req, res)
);

export default router;
