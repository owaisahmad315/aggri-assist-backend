import app from '../src/app';
import { config } from '../src/config/env';
import { connectDB } from '../src/config/database';
import { logger } from '../src/utils/logger';

async function bootstrap() {
  // Connect to MongoDB
  await connectDB();

  // Start server
  const server = app.listen(config.server.port, () => {
    logger.info(`
╔══════════════════════════════════════════╗
║       🌿 AgriAssist Backend Ready        ║
╠══════════════════════════════════════════╣
║  Port    : ${config.server.port}                          ║
║  Env     : ${config.server.nodeEnv.padEnd(10)}                   ║
║  DB      : Connected                    ║
║  HF API  : ${config.huggingface.apiToken ? '✅ Configured' : '⚠️  Not set (add HF_API_TOKEN)'}        ║
╚══════════════════════════════════════════╝
    `.trim()
    );

    logger.info(`API endpoints:`);
    logger.info(`  POST http://localhost:${config.server.port}/api/chat`);
    logger.info(`  POST http://localhost:${config.server.port}/api/diagnose`);
    logger.info(`  POST http://localhost:${config.server.port}/api/transcribe`);
    logger.info(`  POST http://localhost:${config.server.port}/api/auth/register`);
    logger.info(`  POST http://localhost:${config.server.port}/api/auth/login`);
    logger.info(`  GET  http://localhost:${config.server.port}/api/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down server...');
    server.close(() => {
      logger.info('Server closed. Goodbye 👋');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection:', reason);
  });
}

bootstrap();