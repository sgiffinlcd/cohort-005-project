import { and, eq, inArray, sql } from "drizzle-orm";
import type { db as appDb } from "~/db";
import {
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";

type Database = typeof appDb;

export type RefundDecision =
  | { outcome: "approve" }
  | { outcome: "decline"; declineReason: string };

export type DecisionResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-decided" };

/**
 * Records an Admin's decision on a Refund Request. The update only applies
 * while the request is still open, so a second Admin cannot overwrite the
 * first Admin's decision. Approving refunds the full amount paid; it does not
 * move any money.
 */
export function decideRefundRequest(
  database: Database,
  input: { refundRequestId: number; adminUserId: number } & RefundDecision
): DecisionResult {
  const request = database
    .select({ id: refunds.id, amountPaid: purchases.amountPaid })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(eq(refunds.id, input.refundRequestId))
    .get();

  if (!request) return { ok: false, reason: "not-found" };

  const approved = input.outcome === "approve";

  const updated = database
    .update(refunds)
    .set({
      status: approved ? RefundStatus.Approved : RefundStatus.Declined,
      amountRefunded: approved ? request.amountPaid : null,
      declineReason: input.outcome === "decline" ? input.declineReason : null,
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: input.adminUserId,
    })
    .where(
      and(
        eq(refunds.id, input.refundRequestId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .returning({ id: refunds.id })
    .all();

  return updated.length === 0
    ? { ok: false, reason: "already-decided" }
    : { ok: true };
}

/** How much of the course the learner has used, for the Admin to weigh. */
export function getUsageEvidence(
  database: Database,
  userId: number,
  courseId: number
) {
  const lessonIds = database
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);

  if (lessonIds.length === 0) {
    return { secondsWatched: 0, completedLessons: 0, totalLessons: 0 };
  }

  const completedLessons =
    database
      .select({ count: sql<number>`count(*)` })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          inArray(lessonProgress.lessonId, lessonIds)
        )
      )
      .get()?.count ?? 0;

  const secondsWatched = database
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);

  return { secondsWatched, completedLessons, totalLessons: lessonIds.length };
}
