import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { cleanupFiles } from '../middleware/upload';
import { HfInference } from '@huggingface/inference';
import fs from 'fs';
import { config } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';

const hf = new HfInference(config.huggingface.apiToken || undefined);

export async function transcribe(req: AuthRequest, res: Response): Promise<void> {
  const file = req.file;

  if (!file) {
    sendError(res, 'Audio file is required', 400, 'NO_AUDIO');
    return;
  }

  logger.info(`Transcribing audio: ${file.filename} (${(file.size / 1024).toFixed(1)} KB)`);

  try {
    const audioBuffer = fs.readFileSync(file.path);
    const blob = new Blob([audioBuffer], { type: file.mimetype || 'audio/webm' });

    const result = await hf.automaticSpeechRecognition({
      model: 'openai/whisper-small',
      data: blob,
    });

    const text = result.text?.trim() ?? '';

    if (!text) {
      sendError(res, 'Could not transcribe audio. Please try speaking more clearly.', 422, 'TRANSCRIPTION_EMPTY');
      return;
    }

    logger.info(`Transcription result: "${text.slice(0, 100)}"`);
    sendSuccess(res, { text });
  } finally {
    if (file) cleanupFiles([file]);
  }
}