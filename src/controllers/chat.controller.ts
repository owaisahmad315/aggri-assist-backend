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
import { config } from '../config/env';
 
// ─── Qalb LLM via HuggingFace Inference API ───────────────────────────────────
// Model: enstazao/Qalb-1.0-8B-Instruct
// Pakistan's first Urdu LLM — LLaMA 3.1 8B fine-tuned on 1.97B Urdu tokens
// Llama-3 chat format with Urdu system prompt

const QALB_MODEL = 'enstazao/Qalb-1.0-8B-Instruct';
const HF_BASE    = 'https://router.huggingface.co/hf-inference/models';

// Urdu agricultural system prompt for Qalb
const AGRI_SYSTEM_PROMPT = `آپ ایک ماہر زرعی مشیر ہیں جو کسانوں کو فصلوں کی بیماریوں، کیڑوں، غذائی کمیوں اور زرعی بہترین طریقوں کے بارے میں مفید مشورے دیتے ہیں۔ آپ اردو میں جواب دیتے ہیں۔ آپ کے جوابات سادہ، عملی اور کسانوں کے لیے قابل فہم ہونے چاہئیں۔`;

async function callQalb(userMessage: string, apiToken: string): Promise<string> {
  // Llama-3 style prompt format used by Qalb
  const prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>
${AGRI_SYSTEM_PROMPT}<|eot_id|><|start_header_id|>user<|end_header_id|>
${userMessage}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
`;

  const response = await fetch(`${HF_BASE}/${QALB_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: 512,
        temperature: 0.7,
        top_p: 0.9,
        repetition_penalty: 1.1,
        do_sample: true,
        return_full_text: false,
      },
    }),
  });

  if (response.status === 503) throw new Error('MODEL_LOADING');

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`QALB_${response.status}: ${err.slice(0, 120)}`);
  }

  const data = await response.json() as Array<{ generated_text: string }> | { error: string };

  if ('error' in data) throw new Error(`QALB_ERROR: ${(data as any).error}`);

  const text = (data as Array<{ generated_text: string }>)[0]?.generated_text?.trim();
  if (!text) throw new Error('QALB_EMPTY_RESPONSE');

  return text;
}

// ─── Simple rule-based Urdu agri fallback (when Qalb is loading) ─────────────
function getUrduFallbackResponse(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('بیماری') || lower.includes('بلائٹ') || lower.includes('disease')) {
    return 'فصل کی بیماری کی تشخیص کے لیے متاثرہ پتوں کی تصویر اپ لوڈ کریں۔ میں AI کے ذریعے بیماری کی شناخت کر کے علاج تجویز کروں گا۔';
  }
  if (lower.includes('کھاد') || lower.includes('fertilizer') || lower.includes('nutrient')) {
    return 'مناسب کھاد کے استعمال کے لیے پہلے مٹی کا ٹیسٹ کروائیں۔ نائٹروجن، فاسفورس اور پوٹاشیم کا توازن فصل کی صحت کے لیے ضروری ہے۔';
  }
  if (lower.includes('پانی') || lower.includes('آبپاشی') || lower.includes('water')) {
    return 'آبپاشی صبح کے وقت کریں تاکہ پتے جلدی خشک ہوں۔ زیادہ پانی سے جڑوں کی سڑن ہو سکتی ہے۔ ٹپک آبپاشی بہترین طریقہ ہے۔';
  }

  return `آپ کا سوال موصول ہوا: "${message}"\n\nبہترین تشخیص کے لیے اپنی فصل کی تصویر اپ لوڈ کریں۔ میں AI کے ذریعے بیماری، کیڑے یا غذائی کمی کی فوری شناخت کر سکتا ہوں۔`;
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
  logger.info(`Chat | session: ${sid} | images: ${files.length} | msg: "${message.slice(0, 60)}"`);

  try {
    let reply: string;
    const imageAnalyses: any[] = [];

    if (files.length > 0) {
      // ── Images attached → run HF plant disease classification ─────────────
      const diagnosisResults = await Promise.all(
        files.map((file) =>
          classifyPlantDisease(file.path).catch((err): PlantDiagnosisResult => {
            logger.error(`Classification failed for ${file.filename}: ${err.message}`);
            return {
              rawResults: [], topPrediction: 'Error', confidence: 0,
              isHealthy: false, diseaseName: null, plantName: null,
              severity: 'mild', humanReadable: `Could not analyse: ${file.originalname}`,
            };
          })
        )
      );

      // Build Urdu diagnosis narrative, then pass to Qalb for enriched Urdu response
      const baseNarrative = buildDiagnosisNarrative(diagnosisResults, message);

      if (config.huggingface.apiToken?.trim()) {
        try {
          // Ask Qalb to expand the diagnosis into a natural Urdu response
          const qalbPrompt = `مندرجہ ذیل فصل کی تشخیص کو اردو میں کسان کے لیے سادہ اور مددگار انداز میں بیان کریں:\n\n${baseNarrative}`;
          reply = await callQalb(qalbPrompt, config.huggingface.apiToken);
        } catch (qalbErr: any) {
          logger.warn(`Qalb unavailable for image enrichment (${qalbErr.message}), using base narrative`);
          reply = baseNarrative; // fall back to English narrative
        }
      } else {
        reply = baseNarrative;
      }

      diagnosisResults.forEach((d, i) => {
        imageAnalyses.push({
          filename: files[i].filename, originalName: files[i].originalname,
          mimeType: files[i].mimetype, sizeBytes: files[i].size,
          hfResults: d.rawResults, topPrediction: d.topPrediction, confidence: d.confidence,
        });
      });

    } else {
      // ── Text only → send to Qalb LLM ──────────────────────────────────────
      if (config.huggingface.apiToken?.trim()) {
        try {
          reply = await callQalb(message, config.huggingface.apiToken);
        } catch (err: any) {
          if (err.message === 'MODEL_LOADING') {
            logger.warn('Qalb model loading, using Urdu fallback response');
            reply = 'Qalb ماڈل لوڈ ہو رہا ہے۔ 20-30 سیکنڈ بعد دوبارہ کوشش کریں۔\n\n' + getUrduFallbackResponse(message);
          } else {
            logger.error(`Qalb error: ${err.message}`);
            reply = getUrduFallbackResponse(message);
          }
        }
      } else {
        reply = getUrduFallbackResponse(message);
      }
    }

    // ── Persist conversation to MongoDB ────────────────────────────────────
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