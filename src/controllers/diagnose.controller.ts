import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { cleanupFiles } from '../middleware/upload';
import {
  classifyPlantDisease,
  buildDiagnosisNarrative,
  PlantDiagnosisResult,
} from '../services/huggingface.service';
import { Query } from '../models/Query';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export async function diagnose(req: AuthRequest, res: Response): Promise<void> {
  const files = req.files as Express.Multer.File[];
  const { message = '', sessionId } = req.body;

  if (!files || files.length === 0) {
    sendError(res, 'At least one image is required for diagnosis', 400, 'NO_IMAGES');
    return;
  }

  logger.info(`Diagnosing ${files.length} image(s) for session ${sessionId ?? 'anonymous'}`);

  try {
    // ── Run classification on each image in parallel ──────────────────────
    const diagnosisPromises = files.map((file) =>
      classifyPlantDisease(file.path).catch((err): PlantDiagnosisResult => {
        logger.error(`Failed to classify ${file.filename}: ${err.message}`);
        return {
          rawResults: [],
          topPrediction: 'Error',
          confidence: 0,
          isHealthy: false,
          diseaseName: null,
          plantName: null,
          severity: 'mild',
          humanReadable: `Could not analyse image: ${file.originalname}`,
        };
      })
    );

    const diagnoses = await Promise.all(diagnosisPromises);

    // ── Build narrative reply ─────────────────────────────────────────────
    const reply = buildDiagnosisNarrative(diagnoses, message);

    // ── Persist to MongoDB ────────────────────────────────────────────────
    const sid = sessionId ?? uuidv4();
    const imageAnalyses = diagnoses.map((d, i) => ({
      filename: files[i].filename,
      originalName: files[i].originalname,
      mimeType: files[i].mimetype,
      sizeBytes: files[i].size,
      hfResults: d.rawResults,
      topPrediction: d.topPrediction,
      confidence: d.confidence,
    }));

    await Query.findOneAndUpdate(
      { sessionId: sid },
      {
        $setOnInsert: { userId: req.userId, sessionId: sid },
        $push: {
          messages: {
            $each: [
              { role: 'user', content: message || 'Image analysis request', images: imageAnalyses, timestamp: new Date() },
              { role: 'assistant', content: reply, timestamp: new Date() },
            ],
          },
        },
      },
      { upsert: true, new: true }
    );

    // ── Send response ─────────────────────────────────────────────────────
    sendSuccess(res, {
      sessionId: sid,
      reply,
      diagnoses: diagnoses.map((d) => ({
        topPrediction: d.topPrediction,
        confidence: d.confidence,
        isHealthy: d.isHealthy,
        diseaseName: d.diseaseName,
        plantName: d.plantName,
        severity: d.severity,
        humanReadable: d.humanReadable,
      })),
    });
  } finally {
    // Always clean up uploaded files
    cleanupFiles(files);
  }
}