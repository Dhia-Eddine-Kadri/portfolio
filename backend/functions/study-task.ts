// PATCH /api/study/tasks/:id
// Updates the status of a weekly_study_tasks row with validated transitions.

import { fail, handleOptions, jsonResponse } from '../lib/responses';
import { bodyJson, requireStudyAuth, writeStudyEvent } from '../lib/study-planner';
import { supaRequest } from '../lib/supabase-admin';
import type { LambdaResponse, NetlifyEvent } from '../lib/types';

// Allowed status transitions.
const VALID_TRANSITIONS: Record<string, string[]> = {
  todo: ['in_progress', 'completed', 'skipped', 'moved'],
  in_progress: ['completed', 'skipped', 'moved'],
  completed: ['todo'], // undo only
  skipped: ['todo', 'in_progress'],
  moved: ['todo'],
};

export const handler = async (event: NetlifyEvent): Promise<LambdaResponse> => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'PATCH') return fail(405, 'Method not allowed');

  const auth = await requireStudyAuth(event);
  if ('statusCode' in auth) return auth;
  const body = bodyJson(event);
  if ((body as LambdaResponse).statusCode) return body as LambdaResponse;
  const data = body as Record<string, unknown>;
  const taskId = taskIdFromPath(event.path);
  if (!taskId) return fail(400, 'Task id is required');

  const newStatus = typeof data.status === 'string' ? data.status : '';
  if (!newStatus) return fail(400, 'status is required');

  // Fetch current task.
  const currentRes = await supaRequest<
    Array<{
      id: string;
      user_id: string;
      course_id: string;
      topic_id: string | null;
      status: string;
    }>
  >(
    'GET',
    'weekly_study_tasks?id=eq.' +
      encodeURIComponent(taskId) +
      '&user_id=eq.' +
      encodeURIComponent(auth.user.id) +
      '&select=id,user_id,course_id,topic_id,status&limit=1',
    null,
    auth.serviceKey
  );
  const current = Array.isArray(currentRes.body) ? currentRes.body[0] ?? null : null;
  if (!current) return fail(404, 'Task not found');

  // Validate transition.
  const allowed = VALID_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return fail(
      409,
      `Cannot transition task from '${current.status}' to '${newStatus}'`
    );
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: newStatus,
    status_changed_at: now,
    updated_at: now,
  };
  if (newStatus === 'moved' && typeof data.movedToDate === 'string') {
    patch['plan_date'] = data.movedToDate;
  }

  const updated = await supaRequest(
    'PATCH',
    'weekly_study_tasks?id=eq.' +
      encodeURIComponent(taskId) +
      '&user_id=eq.' +
      encodeURIComponent(auth.user.id),
    patch,
    auth.serviceKey,
    { Prefer: 'return=representation' }
  );

  await writeStudyEvent(auth.serviceKey, {
    user_id: auth.user.id,
    course_id: current.course_id,
    topic_id: current.topic_id,
    task_id: taskId,
    event_type: 'task_' + newStatus,
    metadata: { previousStatus: current.status },
  });

  // Update topic state when a study task is completed.
  if (newStatus === 'completed' && current.topic_id) {
    await supaRequest(
      'POST',
      'student_topic_state',
      {
        user_id: auth.user.id,
        course_id: current.course_id,
        topic_id: current.topic_id,
        progress_state: 'studied',
        last_studied_at: now,
        study_sessions: 1,
      },
      auth.serviceKey,
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    ).catch(() => undefined);
  }

  return jsonResponse(200, {
    task: Array.isArray(updated.body) ? updated.body[0] ?? null : null,
  });
};

function taskIdFromPath(path: string | undefined): string | null {
  const match = String(path || '').match(/\/api\/study\/tasks\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}
