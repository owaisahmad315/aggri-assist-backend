import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  server: {
    port: parseInt(optional('PORT', '5000'), 10),
    nodeEnv: optional('NODE_ENV', 'development'),
    isDev: optional('NODE_ENV', 'development') === 'development',
  },
  db: {
    uri: optional('MONGODB_URI', 'mongodb://localhost:27017/agri-assist'),
  },
  jwt: {
    secret: optional('JWT_SECRET', 'change_this_secret_in_production'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },
  huggingface: {
    apiToken: optional('HF_API_TOKEN', ''),
    plantDiseaseModel: optional(
      'HF_PLANT_DISEASE_MODEL',
      'linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification'
    ),
    visionModel: optional(
      'HF_VISION_MODEL',
      'Salesforce/blip-image-captioning-large'
    ),
  },
  upload: {
    maxFileSizeMb: parseInt(optional('MAX_FILE_SIZE_MB', '10'), 10),
    maxFilesPerRequest: parseInt(optional('MAX_FILES_PER_REQUEST', '5'), 10),
    uploadDir: optional('UPLOAD_DIR', './uploads'),
  },
  cors: {
    allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:5173').split(','),
  },
  rateLimit: {
    windowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10),
    max: parseInt(optional('RATE_LIMIT_MAX_REQUESTS', '100'), 10),
  },
} as const;