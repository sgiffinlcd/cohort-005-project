import { describe, it, expect } from "vitest";
import { getRefundWindow, isWithinRefundWindow } from "./refund-window";

// Local-time constructors, because the rule uses the server's local date.
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe("getRefundWindow", () => {
  it("ends 14 days after the purchase day, so the 1st ends on the 15th", () => {
    expect(getRefundWindow(at(2026, 3, 1, 10))).toEqual({
      purchasedDay: "2026-03-01",
      lastDay: "2026-03-15",
    });
  });

  it("ignores the time of day of the purchase", () => {
    expect(getRefundWindow(at(2026, 3, 1, 23, 59)).lastDay).toBe("2026-03-15");
    expect(getRefundWindow(at(2026, 3, 1, 0, 0)).lastDay).toBe("2026-03-15");
  });

  it("crosses month boundaries", () => {
    expect(getRefundWindow(at(2026, 1, 25, 12)).lastDay).toBe("2026-02-08");
  });
});

describe("isWithinRefundWindow", () => {
  const purchased = at(2026, 3, 1, 23, 0);

  it("accepts the whole last day, even before the purchase's time of day", () => {
    expect(isWithinRefundWindow(purchased, at(2026, 3, 15, 0, 1))).toBe(true);
    expect(isWithinRefundWindow(purchased, at(2026, 3, 15, 23, 59))).toBe(true);
  });

  it("rejects the day after the last day", () => {
    expect(isWithinRefundWindow(purchased, at(2026, 3, 16, 0, 1))).toBe(false);
  });

  it("accepts the purchase day itself", () => {
    expect(isWithinRefundWindow(purchased, at(2026, 3, 1, 23, 30))).toBe(true);
  });
});
