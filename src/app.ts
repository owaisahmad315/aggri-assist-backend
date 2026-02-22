import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config/env';
import { logger } from './utils/logger';
import { errorHandler, notFound } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth.routes';
import diagnoseRoutes from './routes/diagnose.routes';
import chatRoutes from './routes/chat.routes';
import transcribeRoutes from './routes/transcribe.routes';
import sessionRoutes from './routes/sessions.routes';

const app = express();

// ─── Trust proxy (required for Railway / any reverse-proxy host) ──────────────
// Must be set BEFORE rate-limiters so express-rate-limit can read the real
// client IP from the X-Forwarded-For header without throwing a ValidationError.
app.set('trust proxy', 1);

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Exact-match against the configured allow-list
      if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);

      // Also allow any *.vercel.app preview deployment for this project
      if (/^https:\/\/aggri-assist[^.]*\.vercel\.app$/.test(origin)) return callback(null, true);

      logger.warn(`CORS: Origin ${origin} not allowed`);
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

// Stricter limit for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { success: false, error: 'AI request limit reached. Please wait a moment.' },
});

app.use(limiter);

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/api/health',
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: config.server.nodeEnv,
    hfConfigured: !!config.huggingface.apiToken,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/diagnose', aiLimiter, diagnoseRoutes);
app.use('/api/chat', aiLimiter, chatRoutes);
app.use('/api/transcribe', aiLimiter, transcribeRoutes);
app.use('/api/sessions', sessionRoutes);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;