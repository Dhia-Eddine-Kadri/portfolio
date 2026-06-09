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

  try {
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

    // Transform WeeklyStudyTask → DailyMissionTask
    const formattedTasks = tasks.map((t) => ({
      id: t.id,
      title: t.task_title,
      description: t.task_description,
      task_type: t.task_type,
      priority_group: (t.priority_score ?? 0.5) >= 0.8 ? 'must_do' : (t.priority_score ?? 0.5) >= 0.5 ? 'should_do' : 'optional',
      status: t.status,
      estimated_minutes: t.estimated_minutes,
      page_start: undefined,
      page_end: undefined,
      reason: undefined,
      reason_code: undefined,
      source_file_id: t.source_file_id,
    }));

    const completed = formattedTasks.filter((t) => t.status === 'completed').length;
    const remaining = formattedTasks
      .filter((t) => !['completed', 'replaced'].includes(t.status))
      .reduce((s, t) => s + (t.estimated_minutes || 0), 0);

    return jsonResponse(200, {
      planId: result.planId,
      taskCount: result.taskCount,
      subjects: result.subjects,
      hasPlan: true,
      tasks: formattedTasks,
      summary: {
        completedTasks: completed,
        totalTasks: tasks.length,
        minutesRemaining: remaining,
        status: 'active',
      },
      meta: {
        message: result.urgency ? (result.urgency.isUrg ? '⚠️ You\'re behind schedule. Focus on exams and practice.' : '') : '',
        recommendExamGeneration: result.urgency?.phase === 'crisis' || result.urgency?.phase === 'final_week',
        recommendCheatsheet: result.urgency?.recommendCheatsheet,
        daysUntilExam: result.urgency?.daysUntilExam,
        studiedPercentage: result.urgency?.studiedPercentage,
      },
    });
  } catch (err) {
    console.error('[study-daily-plan-generate] Error:', err);
    return fail(500, 'Failed to generate daily mission');
  }
};
