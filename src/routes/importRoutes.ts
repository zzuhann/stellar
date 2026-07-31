import { Router } from 'express';
import { ImportController } from '../controllers/importController';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { validateRequest, importSchemas } from '../middleware/validation';
import { importParseCaptionLimiter, importFetchImageLimiter } from '../middleware/rateLimiters';

const router = Router();
const importController = new ImportController();

// 貼文半自動匯入輔助（Phase A）：僅限管理員使用，見
// specs/features/event-import-assistant/design-backend.md
router.post(
  '/parse-caption',
  authenticateToken,
  requireAdmin,
  importParseCaptionLimiter,
  validateRequest({ body: importSchemas.parseCaption }),
  importController.parseCaption
);

router.post(
  '/fetch-image',
  authenticateToken,
  requireAdmin,
  importFetchImageLimiter,
  validateRequest({ body: importSchemas.fetchImage }),
  importController.fetchImage
);

export default router;
