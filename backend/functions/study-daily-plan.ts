// GET /api/study/daily-plan?date=YYYY-MM-DD&courseId=...

import { fail, handleOptions, jsonResponse } from '../lib/responses';
import {
  getDailyTasks,
  localPlanDate,
  requireStudyAuth,
  validateCourseId,
} from '../lib/study-planner';
import type { LambdaResponse, NetlifyEvent } from '../lib/types';

export const handler = async (event: NetlifyEvent): Promise<LambdaResponse> => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return fail(405, 'Method not allowed');

  const auth = await requireStudyAuth(event);
  if ('statusCode' in auth) return auth;

  const qs = event.queryStringParameters || {};
  const courseId = validateCourseId(qs.courseId);
  if (typeof courseId !== 'string') return courseId;
  const { planDate } = localPlanDate(qs.date, qs.timezone);

  try {
    const tasks = await getDailyTasks(auth.user.id, new Date(planDate + 'T00:00:00Z'), auth.serviceKey, courseId);
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const remaining = tasks
      .filter((t) => !['completed', 'replaced'].includes(t.status))
      .reduce((s, t) => s + (t.estimated_minutes || 0), 0);

    return jsonResponse(200, {
      hasPlan: tasks.length > 0,
      tasks,
      summary: {
        completedTasks: completed,
        totalTasks: tasks.length,
        minutesRemaining: remaining,
        status: 'active',
      },
    });
  } catch (err) {
    console.error('[study-daily-plan] Error:', err);
    return fail(500, 'Failed to load daily mission');
  }
};
