import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User';
import { config } from '../config/env';
import { sendSuccess, sendError, sendValidationError } from '../utils/response';
import { logger } from '../utils/logger';

function signToken(userId: string, name: string): string {
  return jwt.sign({ id: userId, name }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

// ─── Validation rules ────────────────────────────────────────────────────────

export const registerValidation = [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2–80 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
];

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function register(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendValidationError(res, errors.array());
    return;
  }

  const { name, email, password } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      sendError(res, 'An account with this email already exists', 409, 'EMAIL_TAKEN');
      return;
    }

    const user = await User.create({ name, email, password });
    const token = signToken(user._id.toString(), user.name);

    logger.info(`New user registered: ${email}`);
    sendSuccess(res, { token, user: { id: user._id, name: user.name, email: user.email } }, 201, 'Account created');
  } catch (err) {
    throw err; // handled by global error handler
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendValidationError(res, errors.array());
    return;
  }

  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
      return;
    }

    const token = signToken(user._id.toString(), user.name);

    logger.info(`User logged in: ${email}`);
    sendSuccess(res, { token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    throw err;
  }
}

export async function getMe(req: Request & { userId?: string }, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }
    sendSuccess(res, { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt });
  } catch (err) {
    throw err;
  }
}