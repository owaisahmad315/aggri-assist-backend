import { Router } from 'express';
import { chat } from '../controllers/chat.controller';
import { upload } from '../middleware/upload';
import { optionalAuth } from '../middleware/auth';
import { config } from '../config/env';

const router = Router();

/**
 * POST /api/chat
 * Body (multipart/form-data):
 *   - message: string
 *   - images: File[] (optional)
 *   - sessionId: string (optional)
 *   - history: JSON string of past messages (optional)
 */
router.post(
  '/',
  optionalAuth,
  upload.array('images', config.upload.maxFilesPerRequest),
  chat
);

export default router;