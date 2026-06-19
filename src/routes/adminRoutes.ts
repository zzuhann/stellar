import { Router } from 'express';
import { AdminController } from '../controllers/adminController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const adminController = new AdminController();

router.get('/events', authenticateToken, requireAdmin, adminController.getEvents);
router.get('/artists', authenticateToken, requireAdmin, adminController.getArtists);

export default router;
