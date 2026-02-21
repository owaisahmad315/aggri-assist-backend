import { Router } from 'express';
import { register, login, getMe, registerValidation, loginValidation } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', registerValidation, register);

// POST /api/auth/login
router.post('/login', loginValidation, login);

// GET /api/auth/me  (protected)
router.get('/me', authenticate, getMe);

export default router;