import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { logger } from '../utils/logger';
import { sendError } from '../utils/response';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(`[${req.method} ${req.path}] ${err.message}`, {
    stack: err.stack,
    body: req.body,
  });

  // Multer errors
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      sendError(res, 'File too large. Maximum size is 10MB.', 413, 'FILE_TOO_LARGE');
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      sendError(res, 'Too many files. Maximum is 5 per request.', 413, 'TOO_MANY_FILES');
      return;
    }
    sendError(res, err.message, 400, 'UPLOAD_ERROR');
    return;
  }

  // File type error from multer fileFilter
  if (err.message.startsWith('Unsupported file type')) {
    sendError(res, err.message, 400, 'INVALID_FILE_TYPE');
    return;
  }

  // Mongoose validation
  if (err.name === 'ValidationError') {
    sendError(res, err.message, 422, 'VALIDATION_ERROR');
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    sendError(res, 'Invalid or expired token', 401, 'TOKEN_INVALID');
    return;
  }

  // HuggingFace API errors
  if (err.message.includes('HuggingFace') || err.message.includes('503')) {
    sendError(
      res,
      'AI model is currently loading. Please try again in 20–30 seconds.',
      503,
      'MODEL_LOADING'
    );
    return;
  }

  // Default
  sendError(
    res,
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    500,
    'INTERNAL_ERROR'
  );
}

export function notFound(req: Request, res: Response): void {
  sendError(res, `Route not found: ${req.method} ${req.path}`, 404, 'NOT_FOUND');
}