import { Router } from 'express';
import { diagnose } from '../controllers/diagnose.controller';
import { upload } from '../middleware/upload';
import { optionalAuth } from '../middleware/auth';
import { config } from '../config/env';

const router = Router();

/**
 * POST /api/diagnose
 * Body (multipart/form-data):
 *   - images: File[] (1–5 crop images)
 *   - message: string (optional user description)
 *   - sessionId: string (optional, for continuing a session)
 */
router.post(
  '/',
  optionalAuth,
  upload.array('images', config.upload.maxFilesPerRequest),
  diagnose
);

export default router;