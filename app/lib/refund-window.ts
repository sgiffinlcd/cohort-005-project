export const REFUND_WINDOW_DAYS = 14;

/** A calendar date as YYYY-MM-DD, in the server's local time. Time of day is dropped. */
export function toDay(when: Date | string): string {
  const date = typeof when === "string" ? new Date(when) : when;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The Refund Window for a purchase: the 14 calendar days after the day of
 * purchase. The purchase day itself is day 0, so a purchase on the 1st ends
 * on the 15th. The time of day never matters.
 */
export function getRefundWindow(purchasedAt: Date | string) {
  const purchasedDay = toDay(purchasedAt);
  const start = new Date(purchasedAt);
  start.setDate(start.getDate() + REFUND_WINDOW_DAYS);
  return { purchasedDay, lastDay: toDay(start) };
}

/** Whether a given moment falls on a day inside the purchase's Refund Window. */
export function isWithinRefundWindow(
  purchasedAt: Date | string,
  when: Date | string = new Date()
): boolean {
  const { purchasedDay, lastDay } = getRefundWindow(purchasedAt);
  const day = toDay(when);
  return day >= purchasedDay && day <= lastDay;
}
