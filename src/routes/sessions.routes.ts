import { Router } from 'express';
import { getSessions, getSession, upsertSession, deleteSession } from '../controllers/sessions.controller';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = Router();

// GET    /api/sessions         — list user sessions (requires auth)
router.get('/', authenticate, getSessions);

// GET    /api/sessions/:id     — get single session
router.get('/:sessionId', optionalAuth, getSession);

// POST   /api/sessions         — create/update session
router.post('/', optionalAuth, upsertSession);

// DELETE /api/sessions/:id     — delete session (requires auth)
router.delete('/:sessionId', authenticate, deleteSession);

export default router;