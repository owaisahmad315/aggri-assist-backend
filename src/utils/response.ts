import { Response } from 'express';

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200, message?: string): Response {
  return res.status(statusCode).json({ success: true, data, message } as ApiSuccess<T>);
}

export function sendError(
  res: Response,
  error: string,
  statusCode = 500,
  code?: string,
  details?: unknown
): Response {
  return res.status(statusCode).json({ success: false, error, code, details } as ApiError);
}

export function sendValidationError(res: Response, details: unknown): Response {
  return sendError(res, 'Validation failed', 422, 'VALIDATION_ERROR', details);
}