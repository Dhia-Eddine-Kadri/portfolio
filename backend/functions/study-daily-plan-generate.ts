// POST /api/study/daily-plan/generate

import { fail, handleOptions, jsonResponse } from '../lib/responses';
import {
  bodyJson,
  generateWeeklyPlan,
  getDailyTasks,
  localPlanDate,
  requireStudyAuth,
  validateCourseId,
} from '../lib/study-planner';
import type { LambdaResponse, NetlifyEvent } from '../lib/types';
import type { PlanScope } from '../lib/study-planner-types';

export const handler = async (event: NetlifyEvent): Promise<LambdaResponse> => {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const auth = await requireStudyAuth(event);
  if ('statusCode' in auth) return auth;
  const body = bodyJson(event);
  if ((body as LambdaResponse).statusCode) return body as LambdaResponse;
  const payload = body as Record<string, unknown>;

  const courseId = validateCourseId(payload.courseId);
  if (typeof courseId !== 'string') return courseId;

  const { planDate } = localPlanDate(payload.date, payload.timezone);
  const scope: PlanScope = payload.scope === 'global_week' ? 'global_week' : 'course_week';

  const result = await generateWeeklyPlan(
    auth.user.id,
    new Date(planDate + 'T00:00:00Z'),
    scope,
    courseId,
    auth.serviceKey
  );

  // Return today's tasks for the generated plan.
  const tasks = await getDailyTasks(
    auth.user.id,
    new Date(planDate + 'T00:00:00Z'),
    auth.serviceKey,
    courseId
  );

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const remaining = tasks
    .filter((t) => !['completed', 'replaced'].includes(t.status))
    .reduce((s, t) => s + (t.estimated_minutes || 0), 0);

  return jsonResponse(200, {
    planId: result.planId,
    taskCount: result.taskCount,
    subjects: result.subjects,
    hasPlan: true,
    tasks,
    summary: {
      completedTasks: completed,
      totalTasks: tasks.length,
      minutesRemaining: remaining,
      status: 'active',
    },
  });
};
