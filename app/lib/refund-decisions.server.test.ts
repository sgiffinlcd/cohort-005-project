import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { decideRefundRequest } from "./refund-decisions.server";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let adminId: number;
let refundRequestId: number;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  adminId = testDb
    .insert(schema.users)
    .values({ name: "Admin", email: "a@example.com", role: schema.UserRole.Admin })
    .returning()
    .get().id;
  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
    })
    .returning()
    .get();
  refundRequestId = testDb
    .insert(schema.refunds)
    .values({ purchaseId: purchase.id, reason: "Wrong course, sorry." })
    .returning()
    .get().id;
});

const load = () =>
  testDb.select().from(schema.refunds).all().find((r) => r.id === refundRequestId)!;

describe("decideRefundRequest", () => {
  it("approving refunds the full amount paid and records the Admin", () => {
    const result = decideRefundRequest(testDb, {
      refundRequestId,
      adminUserId: adminId,
      outcome: "approve",
    });
    expect(result).toEqual({ ok: true });
    expect(load()).toMatchObject({
      status: schema.RefundStatus.Approved,
      amountRefunded: 7900,
      resolvedByUserId: adminId,
      declineReason: null,
    });
  });

  it("declining stores the reason and refunds nothing", () => {
    decideRefundRequest(testDb, {
      refundRequestId,
      adminUserId: adminId,
      outcome: "decline",
      declineReason: "Outside our policy.",
    });
    expect(load()).toMatchObject({
      status: schema.RefundStatus.Declined,
      amountRefunded: null,
      declineReason: "Outside our policy.",
    });
  });

  it("does not let a second decision overwrite the first", () => {
    decideRefundRequest(testDb, { refundRequestId, adminUserId: adminId, outcome: "approve" });
    const second = decideRefundRequest(testDb, {
      refundRequestId,
      adminUserId: adminId,
      outcome: "decline",
      declineReason: "Changed my mind.",
    });
    expect(second).toEqual({ ok: false, reason: "already-decided" });
    expect(load().status).toBe(schema.RefundStatus.Approved);
  });

  it("reports an unknown request", () => {
    expect(
      decideRefundRequest(testDb, { refundRequestId: 999, adminUserId: adminId, outcome: "approve" })
    ).toEqual({ ok: false, reason: "not-found" });
  });
});
