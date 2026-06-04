// POST /api/ai/cheatsheet — proxy to the Python cheatsheet endpoint.
//
// Learning Agent Phase 4. Generates a dense, Topic-Map-driven, source-grounded
// cheatsheet from the user's own materials and (by default) saves it as a note
// of type 'cheatsheet', so it appears in the existing notes list.

import { jsonResponse, fail, handleOptions } from '../lib/responses';
import { optionalEnv, requireEnv } from '../lib/env';
import { verifySupabaseToken, extractBearerToken } from '../lib/supabase-auth';
import { pythonAiConfigured, forwardToPython } from '../lib/python-ai-proxy';
import { enforceEventRateLimit, enforceGenerationCap } from '../lib/rate-limit';
import { requireActiveSubscription } from '../lib/subscription-gate';
import { logSecurityEvent } from '../lib/logger';
import type { LambdaResponse, NetlifyEvent } from '../lib/types';

const AI_GENERATE_RATE_LIMIT_MAX = parseInt(optionalEnv('AI_GENERATE_RATE_LIMIT_MAX', '30'), 10);
const AI_GENERATE_RATE_LIMIT_WINDOW = parseInt(optionalEnv('AI_GENERATE_RATE_LIMIT_WINDOW_MS', String(60 * 60 * 1000)), 10);
const MAX_DOCUMENT_IDS = 25;
const MAX_TOPIC_LENGTH = 500;

interface PyCheatsheetResponse {
  noteId?: string | null;
  title?: string | null;
  text?: string;
  topicsCovered?: unknown[];
  groundedSources?: unknown[];
  warning?: string;
  error?: string;
}

function _docIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_DOCUMENT_IDS);
}

export const handler = async (event: NetlifyEvent): Promise<LambdaResponse> => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');
  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');
  if (!pythonAiConfigured()) return fail(503, 'AI service not configured');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const subBlocked = await requireActiveSubscription(serviceKey, user.id, 'ai_generate');
  if (subBlocked) return subBlocked;

  let body: Record<string, unknown>;
  try { body = JSON.parse(event.body || '{}') as Record<string, unknown>; }
  catch { return fail(400, 'Invalid JSON'); }

  const courseId = body.courseId;
  const topic = body.topic;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (typeof topic === 'string' && topic.length > MAX_TOPIC_LENGTH) return fail(400, 'topic is too long');
  const docIds = _docIds(body.documentIds ?? body.docIds);

  const monthlyCapped = await enforceGenerationCap(serviceKey, user.id);
  if (monthlyCapped) return monthlyCapped;
  const limited = await enforceEventRateLimit(
    serviceKey,
    user.id,
    'ai_generate',
    AI_GENERATE_RATE_LIMIT_MAX,
    AI_GENERATE_RATE_LIMIT_WINDOW,
    'Generation limit reached. Please try again later.'
  );
  if (limited) return limited;

  await logSecurityEvent(serviceKey, user.id, 'ai_generate', {
    course_id: courseId,
    tool: 'cheatsheet',
    document_count: docIds ? docIds.length : 0,
  });

  const upstream = await forwardToPython<PyCheatsheetResponse>('generate-cheatsheet', {
    userId: user.id,
    courseId,
    documentIds: docIds,
    topic: typeof topic === 'string' ? topic : null,
    save: true,
  });
  if (!upstream.ok) {
    const err = (upstream.body as { error?: string }).error;
    return jsonResponse(200, {
      noteId: null,
      title: 'Cheatsheet',
      text: '',
      topicsCovered: [],
      groundedSources: [],
      error: 'Cheatsheet is temporarily unavailable: ' + (err || 'upstream ' + upstream.status),
    });
  }
  return jsonResponse(200, upstream.body);
};
