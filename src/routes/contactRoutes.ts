import { Router } from 'express';
import { submitContact } from '../controllers/contactController';
import { contactLimiter } from '../middleware/rateLimiters';
import { validateRequest, contactSchemas } from '../middleware/validation';

const router = Router();

router.post('/', contactLimiter, validateRequest({ body: contactSchemas.submit }), submitContact);

export default router;
