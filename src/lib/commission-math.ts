export type CommissionBracket = {
  id: string;
  name: string;
  minOrders: number;
  maxOrders: number | null;
  commissionAmount: number; // fixed per-order rate (FIXED type only)
};

export type BracketBreakdown = {
  ruleId: string;
  ruleName: string;
  lBound: number;
  hBound: number | null;
  ordersInBand: number;
  ratePerOrder: number;
  bandTotal: number;
};

export type PiecewiseResult = {
  total: number;
  breakdown: BracketBreakdown[];
};

/**
 * Piecewise marginal commission: each bracket [L_k, H_k] contributes
 * count_k = max(0, min(N, H_k) - max(0, L_k - 1)) orders × R_k rate.
 * Total = Σ count_k × R_k across all brackets.
 *
 * Brackets with maxOrders = null are treated as unbounded (H_k = N).
 * Uncovered indices (gaps in bracket schedule) earn 0.
 * Orders are 1-indexed per spec.
 */
export function computePiecewise(
  n: number,
  brackets: CommissionBracket[],
): PiecewiseResult {
  if (n === 0) return { total: 0, breakdown: [] };

  const sorted = [...brackets].sort((a, b) => a.minOrders - b.minOrders);
  let total = 0;
  const breakdown: BracketBreakdown[] = [];

  for (const bracket of sorted) {
    const lk = bracket.minOrders;
    const hk = bracket.maxOrders !== null ? bracket.maxOrders : n;
    const countK = Math.max(0, Math.min(n, hk) - Math.max(0, lk - 1));
    if (countK > 0) {
      const bandTotal = Math.round(countK * bracket.commissionAmount * 100) / 100;
      total += bandTotal;
      breakdown.push({
        ruleId: bracket.id,
        ruleName: bracket.name,
        lBound: lk,
        hBound: bracket.maxOrders,
        ordersInBand: countK,
        ratePerOrder: bracket.commissionAmount,
        bandTotal,
      });
    }
  }

  return { total: Math.round(total * 100) / 100, breakdown };
}

/**
 * Returns true if any two brackets in the list overlap.
 * Two ranges [A,B] and [C,D] overlap iff A <= D AND C <= B (null = ∞).
 * Used to reject admin-configured bracket schedules with conflicts.
 */
export function bracketsOverlap(
  a: Pick<CommissionBracket, "minOrders" | "maxOrders">,
  b: Pick<CommissionBracket, "minOrders" | "maxOrders">,
): boolean {
  const aMax = a.maxOrders; // null = ∞
  const bMax = b.maxOrders; // null = ∞
  // a <= bMax: a.minOrders <= bMax (always true if bMax null)
  // b <= aMax: b.minOrders <= aMax (always true if aMax null)
  const aLeqBmax = aMax === null || aMax >= b.minOrders;
  const bLeqAmax = bMax === null || bMax >= a.minOrders;
  return aLeqBmax && bLeqAmax;
}
