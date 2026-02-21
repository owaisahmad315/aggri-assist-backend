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

// Simple rule-based fallback responses for text-only queries
function getTextResponse(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hello! I'm AgriAssist, your AI crop health advisor. Upload photos of your crops or ask me about plant diseases, treatments, and farming best practices!";
  }

  if (lower.includes('what can you do') || lower.includes('help') || lower.includes('capabilities')) {
    return `I can help you with:

**🔬 Disease Diagnosis** — Upload crop photos and I'll identify diseases, pests, and nutrient deficiencies using AI vision models.

**💊 Treatment Plans** — Get actionable treatment recommendations tailored to the detected issue.

**🌱 Crop Advice** — Ask about best practices for soil health, irrigation, pest management, and more.

**🎤 Voice Input** — Use the microphone button to speak your queries.

Simply upload an image to get started!`;
  }

  if (lower.includes('blight')) {
    return `**Blight** is a fast-spreading plant disease caused by fungi or bacteria.

**Symptoms:** Rapid browning/blackening of leaves, stems, and fruit; water-soaked spots that spread quickly.

**Treatment:**
• Apply copper-based fungicide immediately
• Remove and destroy affected material
• Avoid overhead watering
• Improve air circulation

Upload an image of your affected plant for a precise diagnosis!`;
  }

  if (lower.includes('fertilizer') || lower.includes('fertiliser') || lower.includes('nutrient')) {
    return `**Nutrient Management Tips:**

• **Nitrogen (N):** Promotes leafy growth. Deficiency = yellowing older leaves.
• **Phosphorus (P):** Root development & flowering. Deficiency = purple-tinted leaves.
• **Potassium (K):** Overall vigor & disease resistance. Deficiency = brown leaf edges.

Always perform a soil test before applying fertilisers. Upload a photo of your plant for a visual diagnosis!`;
  }

  if (lower.includes('water') || lower.includes('irrigation')) {
    return `**Irrigation Best Practices:**

• Water at the base, not on leaves (reduces fungal disease risk)
• Water in the morning so foliage dries during the day
• Most crops prefer deep, infrequent watering over shallow daily watering
• Check soil moisture 2–3 inches deep before watering

Signs of overwatering: yellowing, wilting despite moist soil, root rot.
Signs of underwatering: dry/crispy leaf edges, wilting midday.`;
  }

  // Default
  return `Thank you for your query: *"${message}"*

For the most accurate diagnosis, please **upload a clear photo** of your affected crop. I can then:

1. Identify the specific disease or condition
2. Provide confidence scores
3. Recommend targeted treatments

You can also ask me about specific diseases, nutrients, pests, or farming practices!`;
}

// ─── Chat handler ─────────────────────────────────────────────────────────────

export async function chat(req: AuthRequest, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const { message = '', sessionId, history = '[]' } = req.body;

  if (!message.trim() && files.length === 0) {
    sendError(res, 'Message or images required', 400, 'EMPTY_REQUEST');
    return;
  }

  const sid = sessionId ?? uuidv4();
  logger.info(`Chat request | session: ${sid} | images: ${files.length} | message: "${message.slice(0, 60)}"`);

  try {
    let reply: string;
    const imageAnalyses: any[] = [];

    if (files.length > 0) {
      // ── Image + optional text → run HF diagnosis ────────────────────────
      const diagnosisResults = await Promise.all(
        files.map((file) =>
          classifyPlantDisease(file.path).catch((err): PlantDiagnosisResult => {
            logger.error(`Classification failed for ${file.filename}: ${err.message}`);
            return {
              rawResults: [],
              topPrediction: 'Error',
              confidence: 0,
              isHealthy: false,
              diseaseName: null,
              plantName: null,
              severity: 'mild',
              humanReadable: `Could not analyse: ${file.originalname}`,
            };
          })
        )
      );

      reply = buildDiagnosisNarrative(diagnosisResults, message);

      diagnosisResults.forEach((d, i) => {
        imageAnalyses.push({
          filename: files[i].filename,
          originalName: files[i].originalname,
          mimeType: files[i].mimetype,
          sizeBytes: files[i].size,
          hfResults: d.rawResults,
          topPrediction: d.topPrediction,
          confidence: d.confidence,
        });
      });
    } else {
      // ── Text only ────────────────────────────────────────────────────────
      reply = getTextResponse(message);
    }

    // ── Persist conversation ─────────────────────────────────────────────
    const userMsg = {
      role: 'user' as const,
      content: message || 'Image analysis request',
      ...(imageAnalyses.length > 0 && { images: imageAnalyses }),
      timestamp: new Date(),
    };
    const assistantMsg = { role: 'assistant' as const, content: reply, timestamp: new Date() };

    await Query.findOneAndUpdate(
      { sessionId: sid },
      {
        $setOnInsert: { userId: req.userId ?? null, sessionId: sid },
        $push: { messages: { $each: [userMsg, assistantMsg] } },
      },
      { upsert: true, new: true }
    );

    sendSuccess(res, { sessionId: sid, reply });
  } finally {
    if (files.length > 0) cleanupFiles(files);
  }
}