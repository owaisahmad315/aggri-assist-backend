import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Query } from '../models/Query';
import { sendSuccess, sendError } from '../utils/response';
import { v4 as uuidv4 } from 'uuid';

// GET /sessions — list all sessions for current user
export async function getSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sessions = await Query.find({ userId: req.userId })
      .select('sessionId title createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    sendSuccess(res, sessions);
  } catch (err) {
    throw err;
  }
}

// GET /sessions/:sessionId — get full session with messages
export async function getSession(req: AuthRequest, res: Response): Promise<void> {
  const { sessionId } = req.params;

  try {
    const session = await Query.findOne({ sessionId }).lean();

    if (!session) {
      sendError(res, 'Session not found', 404, 'SESSION_NOT_FOUND');
      return;
    }

    // Ensure user can only access their own sessions
    if (session.userId && session.userId.toString() !== req.userId) {
      sendError(res, 'Forbidden', 403, 'FORBIDDEN');
      return;
    }

    sendSuccess(res, session);
  } catch (err) {
    throw err;
  }
}

// POST /sessions — create or append messages to session
export async function upsertSession(req: AuthRequest, res: Response): Promise<void> {
  const { sessionId, messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    sendError(res, 'Messages array required', 400, 'INVALID_BODY');
    return;
  }

  const sid = sessionId ?? uuidv4();

  try {
    const session = await Query.findOneAndUpdate(
      { sessionId: sid },
      {
        $setOnInsert: { userId: req.userId ?? null, sessionId: sid },
        $set: { messages },
      },
      { upsert: true, new: true }
    );

    sendSuccess(res, { id: session._id, sessionId: sid }, 201);
  } catch (err) {
    throw err;
  }
}

// DELETE /sessions/:sessionId — delete a session
export async function deleteSession(req: AuthRequest, res: Response): Promise<void> {
  const { sessionId } = req.params;

  try {
    const session = await Query.findOne({ sessionId });

    if (!session) {
      sendError(res, 'Session not found', 404, 'SESSION_NOT_FOUND');
      return;
    }

    if (session.userId && session.userId.toString() !== req.userId) {
      sendError(res, 'Forbidden', 403, 'FORBIDDEN');
      return;
    }

    await Query.deleteOne({ sessionId });
    sendSuccess(res, { deleted: true, sessionId });
  } catch (err) {
    throw err;
  }
}