import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { cleanupFiles } from '../middleware/upload';
import fs from 'fs';
import { config } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';

/**
 * POST /api/transcribe  (now also called /api/stt in the Urdu flow)
 *
 * Converts Urdu audio → text using ihanif/whisper-medium-urdu
 * (fine-tuned on Common Voice Urdu, WER 26.9% — best freely-hosted Urdu ASR model)
 *
 * Falls back to openai/whisper-large-v3 (multilingual, supports Urdu)
 * if the primary model is unavailable.
 */

const PRIMARY_MODEL   = 'ihanif/whisper-medium-urdu';
const FALLBACK_MODEL  = 'openai/whisper-large-v3';
const HF_BASE         = 'https://router.huggingface.co/hf-inference/models';

async function callWhisper(model: string, audioBuffer: Buffer, mimeType: string): Promise<string | null> {
  const url = `${HF_BASE}/${model}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.huggingface.apiToken}`,
      'Content-Type': mimeType,
    },
    body: audioBuffer,
  });

  if (response.status === 503) {
    throw new Error('MODEL_LOADING');
  }

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`HF_${response.status}: ${err.slice(0, 120)}`);
  }

  const result = await response.json() as { text?: string; error?: string };

  if ('error' in result && result.error) {
    throw new Error(`HF_ERROR: ${result.error}`);
  }

  return result.text?.trim() ?? null;
}

export async function transcribe(req: AuthRequest, res: Response): Promise<void> {
  const file = req.file;

  if (!file) {
    sendError(res, 'Audio file is required', 400, 'NO_AUDIO');
    return;
  }

  if (!config.huggingface.apiToken?.trim()) {
    sendError(res, 'Speech-to-text not configured. Set HF_API_TOKEN in .env', 503, 'SERVICE_NOT_CONFIGURED');
    return;
  }

  logger.info(`STT request: ${file.filename} (${(file.size / 1024).toFixed(1)} KB)`);

  const audioBuffer = fs.readFileSync(file.path);
  const mimeType = file.mimetype || 'audio/webm';

  try {
    // ── 1. Try primary Urdu-specific Whisper model ─────────────────────────
    let text: string | null = null;

    try {
      logger.info(`Trying primary Urdu model: ${PRIMARY_MODEL}`);
      text = await callWhisper(PRIMARY_MODEL, audioBuffer, mimeType);
      logger.info(`Primary model success: "${text?.slice(0, 80)}"`);
    } catch (primaryErr: any) {
      if (primaryErr.message === 'MODEL_LOADING') {
        // Primary is cold-starting — go straight to fallback for better UX
        logger.warn('Primary Urdu model is loading, trying multilingual fallback...');
      } else {
        logger.warn(`Primary model failed (${primaryErr.message}), trying fallback...`);
      }

      // ── 2. Fallback: whisper-large-v3 (multilingual, supports Urdu) ───────
      try {
        logger.info(`Trying fallback model: ${FALLBACK_MODEL}`);
        text = await callWhisper(FALLBACK_MODEL, audioBuffer, mimeType);
        logger.info(`Fallback model success: "${text?.slice(0, 80)}"`);
      } catch (fallbackErr: any) {
        if (fallbackErr.message === 'MODEL_LOADING') {
          sendError(res, 'Speech models are loading. Please try again in 20–30 seconds.', 503, 'MODEL_LOADING');
          return;
        }
        throw fallbackErr; // re-throw to outer catch
      }
    }

    if (!text) {
      sendError(res, 'Could not transcribe audio. Please speak clearly and try again.', 422, 'TRANSCRIPTION_EMPTY');
      return;
    }

    logger.info(`Transcription complete: "${text.slice(0, 100)}"`);
    sendSuccess(res, { text });

  } catch (err: any) {
    logger.error(`Transcription failed: ${err?.message}`);
    sendError(res, 'Transcription service error. Please try again.', 502, 'HF_ERROR');
  } finally {
    cleanupFiles([file]);
  }
}