import { data, Form, Link, redirect, useActionData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds.$id";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData, parseParams } from "~/lib/validation";
import { db } from "~/db";
import {
  courses,
  purchases,
  refunds,
  users,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import { eq } from "drizzle-orm";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { formatPrice } from "~/lib/utils";
import {
  getRefundWindow,
  isWithinRefundWindow,
  REFUND_WINDOW_DAYS,
  toDay,
} from "~/lib/refund-window";
import {
  decideRefundRequest,
  getUsageEvidence,
} from "~/lib/refund-decisions.server";

// Same limits that gate a learner raising a request. For the Admin they are
// guidance only — an Admin may approve outside them.
const WATCH_LIMIT_SECONDS = 2 * 60 * 60;
const COMPLETION_LIMIT = 0.5;

const paramsSchema = z.object({ id: z.coerce.number().int() });

const decisionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("approve") }),
  z.object({
    intent: z.literal("decline"),
    declineReason: z
      .string()
      .trim()
      .min(10, "Tell the learner why in at least a sentence.")
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
]);

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }
  const user = db.select().from(users).where(eq(users.id, currentUserId)).get();
  if (!user || user.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }
  return user;
}

export function meta() {
  return [{ title: "Refund Request — Cadence" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { id } = parseParams(params, paramsSchema);

  const row = db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      declineReason: refunds.declineReason,
      amountRefunded: refunds.amountRefunded,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      courseId: courses.id,
      courseTitle: courses.title,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(eq(refunds.id, id))
    .get();

  if (!row) throw data("Refund Request not found.", { status: 404 });

  const usage = getUsageEvidence(db, row.learnerId, row.courseId);
  // Judged at the day the learner raised the request, not today.
  const { lastDay } = getRefundWindow(row.purchasedAt);
  const window = {
    purchasedDay: toDay(row.purchasedAt),
    lastDay,
    raisedDay: toDay(row.requestedAt),
    raisedInside: isWithinRefundWindow(row.purchasedAt, row.requestedAt),
  };

  return { request: row, usage, window };
}

export async function action({ request, params }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const { id } = parseParams(params, paramsSchema);

  const parsed = parseFormData(await request.formData(), decisionSchema);
  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const result = decideRefundRequest(db, {
    refundRequestId: id,
    adminUserId: admin.id,
    ...(parsed.data.intent === "approve"
      ? { outcome: "approve" as const }
      : {
          outcome: "decline" as const,
          declineReason: parsed.data.declineReason,
        }),
  });

  if (!result.ok) {
    if (result.reason === "not-found") {
      throw data("Refund Request not found.", { status: 404 });
    }
    return data(
      { errors: { form: "Someone has already decided this request." } },
      { status: 409 }
    );
  }

  return redirect("/admin/refunds");
}

function Evidence({
  label,
  value,
  limit,
  over,
}: {
  label: string;
  value: string;
  limit: string;
  over: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span className={over ? "font-medium text-amber-700" : ""}>
        {value} <span className="text-muted-foreground">(limit {limit})</span>
      </span>
    </div>
  );
}

export default function AdminRefundDetail({ loaderData }: Route.ComponentProps) {
  const { request, usage, window } = loaderData;
  const actionData = useActionData<{ errors?: Record<string, string> }>();
  const isOpen = request.status === RefundStatus.Open;
  const completion =
    usage.totalLessons === 0 ? 0 : usage.completedLessons / usage.totalLessons;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link
        to="/admin/refunds"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Refund Requests
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{request.courseTitle}</h1>
      <p className="text-sm text-muted-foreground">
        {request.learnerName} ({request.learnerEmail}) · paid{" "}
        {formatPrice(request.amountPaid)} on{" "}
        {new Date(request.purchasedAt).toLocaleDateString()}
      </p>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="font-semibold">Their reason</h2>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{request.reason}</p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h2 className="font-semibold">Usage</h2>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>Purchased</span>
            <span>{window.purchasedDay}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Last day in {REFUND_WINDOW_DAYS}-day window</span>
            <span>{window.lastDay}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Request raised</span>
            <span
              className={window.raisedInside ? "" : "font-medium text-amber-700"}
            >
              {window.raisedDay} ·{" "}
              {window.raisedInside ? "inside window" : "outside window"}
            </span>
          </div>
          <Evidence
            label="Time watched"
            value={`${(usage.secondsWatched / 3600).toFixed(1)} h`}
            limit={`${WATCH_LIMIT_SECONDS / 3600} h`}
            over={usage.secondsWatched >= WATCH_LIMIT_SECONDS}
          />
          <Evidence
            label="Lessons completed"
            value={`${usage.completedLessons}/${usage.totalLessons} (${Math.round(completion * 100)}%)`}
            limit={`${COMPLETION_LIMIT * 100}%`}
            over={completion >= COMPLETION_LIMIT}
          />
        </CardContent>
      </Card>

      {isOpen ? (
        <Card className="mt-4">
          <CardHeader>
            <h2 className="font-semibold">Decision</h2>
            <p className="text-sm text-muted-foreground">
              Approving refunds the full {formatPrice(request.amountPaid)}, even
              if the usage above is over a limit.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {actionData?.errors?.form && (
              <p className="text-sm text-red-600">{actionData.errors.form}</p>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="approve" />
              <Button type="submit">Approve refund</Button>
            </Form>
            <Form method="post" className="space-y-2 border-t pt-4">
              <input type="hidden" name="intent" value="decline" />
              <Textarea
                name="declineReason"
                rows={3}
                placeholder="Why is this being declined? The learner will see this."
              />
              {actionData?.errors?.declineReason && (
                <p className="text-sm text-red-600">
                  {actionData.errors.declineReason}
                </p>
              )}
              <Button type="submit" variant="outline">
                Decline
              </Button>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <p className="mt-4 text-sm">
          <span className="font-medium capitalize">{request.status}</span>
          {request.resolvedAt &&
            ` on ${new Date(request.resolvedAt).toLocaleDateString()}`}
          {request.declineReason && ` — ${request.declineReason}`}
        </p>
      )}
    </div>
  );
}
