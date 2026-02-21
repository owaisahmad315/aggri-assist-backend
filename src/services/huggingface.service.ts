import { HfInference } from '@huggingface/inference';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  label: string;
  score: number;
}

export interface PlantDiagnosisResult {
  rawResults: ClassificationResult[];
  topPrediction: string;
  confidence: number;
  isHealthy: boolean;
  diseaseName: string | null;
  plantName: string | null;
  severity: 'healthy' | 'mild' | 'moderate' | 'severe';
  humanReadable: string;
}

export interface ImageCaptionResult {
  caption: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

const hf = new HfInference(config.huggingface.apiToken || undefined);

// ─── Image preprocessing ──────────────────────────────────────────────────────

/**
 * Resize and normalise image for HF model input.
 * Most classification models expect 224×224.
 */
async function preprocessImage(filePath: string): Promise<Buffer> {
  return sharp(filePath)
    .resize(224, 224, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ─── Plant Disease Classification ────────────────────────────────────────────

/**
 * Parse the raw HF label like "Apple___Apple_scab" into human components.
 * Dataset labels follow "Plant___Condition" or "Plant___healthy" convention.
 */
function parseLabel(label: string): { plant: string; condition: string } {
  // Handle both "___" and standard separators
  const parts = label.replace(/_{2,}/g, '|').replace(/_/g, ' ').split('|');
  if (parts.length >= 2) {
    return {
      plant: parts[0].trim(),
      condition: parts.slice(1).join(' ').trim(),
    };
  }
  return { plant: label.trim(), condition: 'unknown' };
}

function mapSeverity(condition: string, confidence: number): PlantDiagnosisResult['severity'] {
  if (condition.toLowerCase().includes('healthy')) return 'healthy';
  if (confidence < 0.4) return 'mild';
  if (confidence < 0.7) return 'moderate';
  return 'severe';
}

export async function classifyPlantDisease(filePath: string): Promise<PlantDiagnosisResult> {
  const imageBuffer = await preprocessImage(filePath);
  const blob = new Blob([imageBuffer], { type: 'image/jpeg' });

  logger.debug(`Sending image to HF model: ${config.huggingface.plantDiseaseModel}`);

  const results = await hf.imageClassification({
    model: config.huggingface.plantDiseaseModel,
    data: blob,
  });

  if (!results || results.length === 0) {
    throw new Error('HuggingFace returned empty classification results');
  }

  // Sort by score descending
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const { plant, condition } = parseLabel(top.label);
  const isHealthy = condition.toLowerCase().includes('healthy');
  const severity = mapSeverity(condition, top.score);

  const humanReadable = isHealthy
    ? `The ${plant} plant appears healthy (${(top.score * 100).toFixed(1)}% confidence).`
    : `Detected ${condition} on ${plant} with ${(top.score * 100).toFixed(1)}% confidence.`;

  return {
    rawResults: sorted.map((r) => ({ label: r.label, score: r.score })),
    topPrediction: top.label,
    confidence: top.score,
    isHealthy,
    diseaseName: isHealthy ? null : condition,
    plantName: plant,
    severity,
    humanReadable,
  };
}

// ─── Image Captioning (BLIP) ─────────────────────────────────────────────────

export async function captionImage(filePath: string): Promise<ImageCaptionResult> {
  const imageBuffer = fs.readFileSync(filePath);
  const blob = new Blob([imageBuffer], { type: 'image/jpeg' });

  const result = await hf.imageToText({
    model: config.huggingface.visionModel,
    data: blob,
  });

  return { caption: result.generated_text ?? 'Unable to generate caption.' };
}

// ─── Compose Full Diagnosis Narrative ────────────────────────────────────────

/**
 * Builds a structured, human-readable diagnosis report from classification results
 * and contextual user message. This is the text the frontend displays as the AI reply.
 */
export function buildDiagnosisNarrative(
  diagnoses: PlantDiagnosisResult[],
  userMessage: string
): string {
  if (diagnoses.length === 0) {
    return "I wasn't able to analyse any images. Please try uploading clearer crop photos.";
  }

  const lines: string[] = [];

  lines.push('## 🌿 Crop Health Analysis\n');

  diagnoses.forEach((d, i) => {
    const label = diagnoses.length > 1 ? `**Image ${i + 1}:** ` : '';

    if (d.isHealthy) {
      lines.push(`${label}✅ **Healthy Plant Detected**`);
      lines.push(`Your ${d.plantName ?? 'plant'} looks healthy with ${(d.confidence * 100).toFixed(1)}% confidence. No disease signs found.`);
    } else {
      const severityEmoji = { mild: '🟡', moderate: '🟠', severe: '🔴', healthy: '🟢' }[d.severity];
      lines.push(`${label}${severityEmoji} **${d.diseaseName ?? 'Issue Detected'}**`);
      lines.push(`- **Plant:** ${d.plantName ?? 'Unknown'}`);
      lines.push(`- **Condition:** ${d.diseaseName}`);
      lines.push(`- **Confidence:** ${(d.confidence * 100).toFixed(1)}%`);
      lines.push(`- **Severity:** ${d.severity.charAt(0).toUpperCase() + d.severity.slice(1)}`);
    }

    // Top 3 alternative predictions
    const alts = d.rawResults.slice(1, 3);
    if (alts.length > 0) {
      lines.push(`\n*Other possibilities:* ${alts.map((a) => {
        const { condition } = parseLabel(a.label);
        return `${condition} (${(a.score * 100).toFixed(1)}%)`;
      }).join(', ')}`);
    }

    lines.push('');
  });

  // Treatment advice based on detected conditions
  const diseased = diagnoses.filter((d) => !d.isHealthy);
  if (diseased.length > 0) {
    lines.push('---\n## 💊 Recommended Actions\n');
    diseased.forEach((d) => {
      const advice = getTreatmentAdvice(d.diseaseName ?? '', d.plantName ?? '');
      lines.push(`**For ${d.diseaseName}:**`);
      advice.forEach((a) => lines.push(`• ${a}`));
      lines.push('');
    });

    lines.push('> ⚠️ *These recommendations are AI-generated. Please consult a local agronomist before applying treatments.*');
  }

  if (userMessage.trim()) {
    lines.push(`\n---\n*Regarding your query: "${userMessage}" — the analysis above addresses the visual symptoms in your uploaded images.*`);
  }

  return lines.join('\n');
}

// ─── Treatment Advice Database ────────────────────────────────────────────────

function getTreatmentAdvice(disease: string, plant: string): string[] {
  const d = disease.toLowerCase();
  const p = plant.toLowerCase();

  if (d.includes('blight')) {
    return [
      'Remove and destroy affected plant parts immediately.',
      'Apply copper-based fungicide (e.g., Bordeaux mixture) every 7–10 days.',
      'Improve air circulation between plants by pruning.',
      'Avoid overhead watering — use drip irrigation if possible.',
      'Rotate crops next season to break the disease cycle.',
    ];
  }
  if (d.includes('rust')) {
    return [
      'Apply sulfur-based or triazole fungicide at first sign.',
      'Remove heavily infected leaves and dispose of them away from the field.',
      'Avoid wetting foliage; water at the base.',
      'Plant rust-resistant varieties in future seasons.',
    ];
  }
  if (d.includes('powdery mildew') || d.includes('mildew')) {
    return [
      'Apply potassium bicarbonate or neem oil spray weekly.',
      'Improve airflow by thinning out dense foliage.',
      'Avoid high-nitrogen fertilisers which promote lush, susceptible growth.',
      'Water in the morning so foliage dries quickly.',
    ];
  }
  if (d.includes('leaf spot') || d.includes('cercospora')) {
    return [
      'Apply chlorothalonil or mancozeb fungicide.',
      'Remove infected leaves and avoid overhead irrigation.',
      'Ensure adequate plant spacing for air circulation.',
      'Mulch around the base to prevent soil splash.',
    ];
  }
  if (d.includes('mosaic') || d.includes('virus')) {
    return [
      'No chemical cure exists for viral diseases — remove infected plants.',
      'Control aphid and whitefly vectors with insecticidal soap.',
      'Use reflective mulches to deter virus-transmitting insects.',
      'Sanitise tools between plants to prevent mechanical spread.',
    ];
  }
  if (d.includes('scab')) {
    return [
      'Apply captan or dodine fungicide preventively.',
      'Prune to open the canopy for better air circulation.',
      'Rake up and destroy fallen leaves which harbour spores.',
      'Choose scab-resistant cultivars for future planting.',
    ];
  }
  if (d.includes('rot')) {
    return [
      'Improve soil drainage to reduce excess moisture.',
      'Apply appropriate fungicide (e.g., metalaxyl for root rot).',
      'Remove and destroy severely affected plants.',
      'Avoid over-irrigation and ensure proper spacing.',
    ];
  }

  // Generic fallback
  return [
    'Isolate affected plants to prevent spread.',
    'Consult your local agricultural extension office with a sample.',
    'Consider a broad-spectrum fungicide as a precaution.',
    'Monitor remaining plants closely for spread of symptoms.',
    'Document symptoms and progression for agronomist review.',
  ];
}