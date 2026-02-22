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

const HF_BASE = 'https://router.huggingface.co/hf-inference/models';

// ─── Image preprocessing ──────────────────────────────────────────────────────

async function preprocessImage(filePath: string): Promise<Buffer> {
  return sharp(filePath)
    .resize(224, 224, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ─── Label parser ─────────────────────────────────────────────────────────────
// Model returns labels like: "Bell_Pepper___Bacterial_spot" or "Tomato___healthy"
// CORRECT order: split on ___ FIRST, then replace single _ with spaces

function parseLabel(raw: string): { plant: string; condition: string } {
  // Step 1: Split on triple underscore separator
  const parts = raw.split('___');

  if (parts.length >= 2) {
    // Step 2: Replace single underscores with spaces in each part separately
    const plant     = parts[0].replace(/_/g, ' ').trim();
    const condition = parts.slice(1).join(' ').replace(/_/g, ' ').trim();
    return { plant, condition };
  }

  // Fallback: no ___ found — treat whole label as plant name
  return { plant: raw.replace(/_/g, ' ').trim(), condition: 'unknown condition' };
}

function mapSeverity(condition: string, confidence: number): PlantDiagnosisResult['severity'] {
  if (condition.toLowerCase().includes('healthy')) return 'healthy';
  if (confidence < 0.4) return 'mild';
  if (confidence < 0.7) return 'moderate';
  return 'severe';
}

// ─── Plant Disease Classification ────────────────────────────────────────────

export async function classifyPlantDisease(filePath: string): Promise<PlantDiagnosisResult> {
  if (!config.huggingface.apiToken?.trim()) {
    throw new Error('HF_API_TOKEN not configured.');
  }

  const imageBuffer = await preprocessImage(filePath);

  logger.debug(`Classifying image with model: ${config.huggingface.plantDiseaseModel}`);

  const response = await fetch(
    `${HF_BASE}/${config.huggingface.plantDiseaseModel}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.huggingface.apiToken}`,
        'Content-Type': 'image/jpeg',
      },
      body: imageBuffer,
    }
  );

  if (response.status === 503) {
    throw new Error('Plant disease model is loading. Please try again in 20 seconds.');
  }

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`HF classification error ${response.status}: ${err.slice(0, 120)}`);
  }

  const results = await response.json() as Array<{ label: string; score: number }>;

  if (!results || results.length === 0) {
    throw new Error('HuggingFace returned empty classification results');
  }

  const sorted = [...results].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const { plant, condition } = parseLabel(top.label);
  const isHealthy = condition.toLowerCase().includes('healthy');
  const severity = mapSeverity(condition, top.score);

  logger.debug(`Top label: "${top.label}" → plant: "${plant}", condition: "${condition}"`);

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

// ─── Diagnosis Narrative ──────────────────────────────────────────────────────

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
      lines.push(`Your **${d.plantName}** looks healthy with **${(d.confidence * 100).toFixed(1)}%** confidence. No disease signs found.`);
    } else {
      const severityEmoji = { mild: '🟡', moderate: '🟠', severe: '🔴', healthy: '🟢' }[d.severity];
      lines.push(`${label}${severityEmoji} **${d.diseaseName}**`);
      lines.push(`- **Plant:** ${d.plantName}`);
      lines.push(`- **Condition:** ${d.diseaseName}`);
      lines.push(`- **Confidence:** ${(d.confidence * 100).toFixed(1)}%`);
      lines.push(`- **Severity:** ${d.severity.charAt(0).toUpperCase() + d.severity.slice(1)}`);
    }

    // Show top 3 alternatives with parsed names
    const alts = d.rawResults.slice(1, 4);
    if (alts.length > 0) {
      const altStr = alts.map((a) => {
        const { plant, condition } = parseLabel(a.label);
        const name = condition === 'unknown condition' ? plant : `${plant} – ${condition}`;
        return `${name} (${(a.score * 100).toFixed(1)}%)`;
      }).join(', ');
      lines.push(`\n*Other possibilities:* ${altStr}`);
    }

    lines.push('');
  });

  // Treatment section
  const diseased = diagnoses.filter((d) => !d.isHealthy);
  if (diseased.length > 0) {
    lines.push('---\n## 💊 Recommended Actions\n');
    diseased.forEach((d) => {
      const advice = getTreatmentAdvice(d.diseaseName ?? '', d.plantName ?? '');
      lines.push(`**For ${d.diseaseName} on ${d.plantName}:**`);
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

function getTreatmentAdvice(disease: string, _plant: string): string[] {
  const d = disease.toLowerCase();

  if (d.includes('blight')) return [
    'Remove and destroy affected plant parts immediately.',
    'Apply copper-based fungicide (e.g., Bordeaux mixture) every 7–10 days.',
    'Improve air circulation between plants by pruning.',
    'Avoid overhead watering — use drip irrigation if possible.',
    'Rotate crops next season to break the disease cycle.',
  ];
  if (d.includes('rust')) return [
    'Apply sulfur-based or triazole fungicide at first sign.',
    'Remove heavily infected leaves and dispose away from the field.',
    'Avoid wetting foliage; water at the base.',
    'Plant rust-resistant varieties in future seasons.',
  ];
  if (d.includes('mildew')) return [
    'Apply potassium bicarbonate or neem oil spray weekly.',
    'Improve airflow by thinning out dense foliage.',
    'Avoid high-nitrogen fertilisers which promote susceptible growth.',
    'Water in the morning so foliage dries quickly.',
  ];
  if (d.includes('bacterial spot') || d.includes('bacterial')) return [
    'Apply copper-based bactericide (copper hydroxide or copper oxychloride).',
    'Remove and destroy heavily infected leaves immediately.',
    'Avoid working with plants when foliage is wet to prevent spread.',
    'Ensure good air circulation — avoid dense planting.',
    'Use disease-free certified seeds for next season.',
    'Avoid overhead irrigation; use drip irrigation instead.',
  ];
  if (d.includes('leaf spot') || d.includes('cercospora') || d.includes('septoria')) return [
    'Apply chlorothalonil or mancozeb fungicide every 7 days.',
    'Remove infected leaves and avoid overhead irrigation.',
    'Ensure adequate plant spacing for air circulation.',
    'Mulch around the base to prevent soil splash onto leaves.',
  ];
  if (d.includes('mosaic') || d.includes('virus') || d.includes('curl')) return [
    'No chemical cure — remove and destroy infected plants immediately.',
    'Control aphid and whitefly vectors with insecticidal soap.',
    'Use reflective mulches to deter virus-transmitting insects.',
    'Sanitise tools between plants to prevent mechanical spread.',
  ];
  if (d.includes('scab')) return [
    'Apply captan or dodine fungicide preventively.',
    'Prune to open the canopy for better air circulation.',
    'Rake up and destroy fallen leaves which harbour spores.',
    'Choose scab-resistant cultivars for future planting.',
  ];
  if (d.includes('rot')) return [
    'Improve soil drainage to reduce excess moisture.',
    'Apply appropriate fungicide (e.g., metalaxyl for root rot).',
    'Remove and destroy severely affected plants.',
    'Avoid over-irrigation and ensure proper spacing.',
  ];
  if (d.includes('anthracnose')) return [
    'Apply mancozeb or azoxystrobin fungicide.',
    'Remove infected fruit and plant debris promptly.',
    'Avoid wetting foliage; water at the base early in the morning.',
    'Ensure proper plant spacing for good air circulation.',
  ];

  return [
    'Isolate affected plants to prevent spread.',
    'Consult your local agricultural extension office with a sample.',
    'Consider a broad-spectrum fungicide as a precaution.',
    'Monitor remaining plants closely for spread of symptoms.',
    'Document symptoms and progression for agronomist review.',
  ];
}