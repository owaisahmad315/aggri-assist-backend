import { Router } from 'express';
import { transcribe } from '../controllers/transcribe.controller';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { optionalAuth } from '../middleware/auth';

const audioUploadDir = path.resolve(config.upload.uploadDir, 'audio');
if (!fs.existsSync(audioUploadDir)) {
  fs.mkdirSync(audioUploadDir, { recursive: true });
}

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, audioUploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for audio
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/x-m4a'];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio type: ${file.mimetype}`));
    }
  },
});

const router = Router();

/**
 * POST /api/transcribe
 * Body (multipart/form-data):
 *   - audio: File (audio recording)
 */
router.post('/', optionalAuth, audioUpload.single('audio'), transcribe);

export default router;