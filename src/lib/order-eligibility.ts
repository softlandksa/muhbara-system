/**
 * Single source of truth for "eligible delivered order" scoping.
 *
 * An eligible order satisfies ALL of:
 *  1. deletedAt IS NULL (not soft-deleted)
 *  2. shippingInfo.deliveredAt within [periodStart, periodEnd]
 *  3. Role-specific attribution (see below)
 *
 * Role attribution rules:
 *  SALES          → orders the employee created (createdById = emp.id)
 *  SHIPPING       → orders the employee physically shipped (shippedById = emp.id)
 *  FOLLOWUP       → orders the employee added ≥1 follow-up note on
 *  SALES_MANAGER  → all orders belonging to the manager's team (teamId)
 *  GENERAL_MANAGER → all delivered orders system-wide (no user/team filter)
 *
 * Returns null when an employee cannot be attributed (e.g. SALES_MANAGER without a team).
 *
 * Used by: commission calculation, leaderboard ranking, personal dashboard.
 */

export type EligibleRole =
  | "SALES"
  | "SHIPPING"
  | "FOLLOWUP"
  | "SALES_MANAGER"
  | "GENERAL_MANAGER";

export function buildDeliveredWhere(
  emp: { id: string; role: string; teamId: string | null },
  periodStart: Date,
  periodEnd: Date,
): Record<string, unknown> | null {
  const deliveredAt = { gte: periodStart, lte: periodEnd };

  switch (emp.role as EligibleRole) {
    case "SALES":
      return { deletedAt: null, createdById: emp.id, shippingInfo: { deliveredAt } };

    case "SHIPPING":
      return { deletedAt: null, shippingInfo: { shippedById: emp.id, deliveredAt } };

    case "FOLLOWUP":
      return {
        deletedAt: null,
        followUpNotes: { some: { createdById: emp.id } },
        shippingInfo: { deliveredAt },
      };

    case "SALES_MANAGER":
      if (!emp.teamId) return null;
      return { deletedAt: null, teamId: emp.teamId, shippingInfo: { deliveredAt } };

    case "GENERAL_MANAGER":
      return { deletedAt: null, shippingInfo: { deliveredAt } };

    default:
      return null;
  }
}
