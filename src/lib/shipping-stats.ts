import { prisma } from "./prisma";

export interface PrimaryStatItem {
  id: string;
  name: string;
  color: string;
  count: number;
  /**
   * True when this primary owns at least one active ShippingStatusSub where
   * marksOrderDelivered=true. Used to identify the "delivered" bucket without
   * hard-coding status names (§12.1).
   * Double-count note: each Order has exactly one statusId, so every order
   * appears in exactly one bucket — no double-count possible.
   */
  isDeliveredBucket: boolean;
}

/**
 * Returns the set of ShippingStatusPrimary IDs that are "delivered" buckets —
 * i.e., they own at least one active ShippingStatusSub with marksOrderDelivered=true.
 * Exported so callers can compute deliveredCount from any Order set without
 * re-running the full getOrderCountsByPrimary aggregation.
 */
export async function getDeliveredPrimaryIds(): Promise<Set<string>> {
  const subs = await prisma.shippingStatusSub.findMany({
    where: { marksOrderDelivered: true, isActive: true, deletedAt: null },
    select: { primaryId: true },
    distinct: ["primaryId"],
  });
  return new Set(subs.map((s) => s.primaryId));
}

/**
 * §12.1 aggregation helper: counts orders by ShippingStatusPrimary.
 *
 * Logic:
 *   - Groups Order.statusId (canonical order state) with a single groupBy query.
 *   - Date filter, when present in `orderWhere`, should target Order.orderDate for
 *     dashboard endpoints; ShippingInfo.shippedAt for shipping-pipeline endpoints
 *     (callers compose the filter before passing it here).
 *   - DELIVERED bucket = primary(ies) that own a sub with marksOrderDelivered=true.
 *     When such a sub is applied, Order.statusId is set to sub.primaryId, so those
 *     orders appear naturally in the correct bucket.
 *   - RETURNED bucket = whichever active primary the caller has set on returned orders
 *     (no dedicated flag needed; it shows up as one of the returned primaries in the
 *     result array).
 *   - READY_TO_SHIP = the primary that new orders receive (sortOrder 0 by convention).
 *     Orders without ShippingInfo are also naturally in this bucket because the
 *     shipping transaction updates statusId only after ShippingInfo is created.
 */
export async function getOrderCountsByPrimary(
  orderWhere: Record<string, unknown>
): Promise<PrimaryStatItem[]> {
  const [allPrimaries, groupBy, deliveredSubs] = await Promise.all([
    prisma.shippingStatusPrimary.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.order.groupBy({
      by: ["statusId"],
      where: orderWhere,
      _count: { id: true },
    }),
    // Identify delivered primaries: any primary that owns a sub with marksOrderDelivered=true
    prisma.shippingStatusSub.findMany({
      where: { marksOrderDelivered: true, isActive: true, deletedAt: null },
      select: { primaryId: true },
      distinct: ["primaryId"],
    }),
  ]);

  const countMap = Object.fromEntries(groupBy.map((g) => [g.statusId, g._count.id]));
  const deliveredPrimaryIds = new Set(deliveredSubs.map((s) => s.primaryId));

  return allPrimaries.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    count: countMap[p.id] ?? 0,
    isDeliveredBucket: deliveredPrimaryIds.has(p.id),
  }));
}
