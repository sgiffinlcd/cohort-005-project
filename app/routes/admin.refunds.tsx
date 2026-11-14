import { data, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import {
  courses,
  purchases,
  refunds,
  users,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import { desc, eq, ne } from "drizzle-orm";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { formatPrice } from "~/lib/utils";

export function meta() {
  return [{ title: "Refund Requests — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  const showDecided = new URL(request.url).searchParams.get("tab") === "decided";

  const rows = db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      learnerName: users.name,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(
      showDecided
        ? ne(refunds.status, RefundStatus.Open)
        : eq(refunds.status, RefundStatus.Open)
    )
    .orderBy(showDecided ? desc(refunds.resolvedAt) : refunds.requestedAt)
    .all();

  return { rows, showDecided };
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { rows, showDecided } = loaderData;
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Refund Requests</h1>
      <div className="mt-4 flex gap-4 text-sm">
        <button
          className={showDecided ? "text-muted-foreground" : "font-semibold"}
          onClick={() => setSearchParams({})}
        >
          Open
        </button>
        <button
          className={showDecided ? "font-semibold" : "text-muted-foreground"}
          onClick={() => setSearchParams({ tab: "decided" })}
        >
          Decided
        </button>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? showDecided
                ? "Nothing has been decided yet."
                : "No Refund Requests are waiting."
              : `${rows.length} ${showDecided ? "decided" : "waiting"}`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((row) => (
            <Link
              key={row.id}
              to={`/admin/refunds/${row.id}`}
              className="block rounded-md border p-3 hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{row.courseTitle}</span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.learnerName} · {formatPrice(row.amountPaid)} · raised{" "}
                {new Date(row.requestedAt).toLocaleDateString()}
              </p>
              <p className="mt-2 line-clamp-2 text-sm">{row.reason}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
