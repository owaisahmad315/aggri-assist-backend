import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { sendError } from '../utils/response';
import { User } from '../models/User';

export interface AuthRequest extends Request {
  userId?: string;
  userName?: string;
}

interface JwtPayload {
  id: string;
  name: string;
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    sendError(res, 'No token provided', 401, 'UNAUTHORIZED');
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.userId = decoded.id;
    req.userName = decoded.name;
    next();
  } catch (err) {
    sendError(res, 'Invalid or expired token', 401, 'TOKEN_INVALID');
  }
}

/** Optional auth — attaches user if token present, continues if not */
export async function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      req.userId = decoded.id;
      req.userName = decoded.name;
    } catch {
      // ignore invalid token for optional routes
    }
  }

  next();
}