import { describe, it, expect } from "vitest";
import { computePiecewise, bracketsOverlap, type CommissionBracket } from "@/lib/commission-math";

const bracket = (
  id: string,
  minOrders: number,
  maxOrders: number | null,
  rate: number,
): CommissionBracket => ({ id, name: id, minOrders, maxOrders, commissionAmount: rate });

// ── computePiecewise ──────────────────────────────────────────────────────────

describe("computePiecewise", () => {
  it("N=0 → total 0, empty breakdown", () => {
    const result = computePiecewise(0, [bracket("b1", 1, 3, 10)]);
    expect(result.total).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it("spec example: N=5, [1,3]×10 + [4,6]×20 = 70", () => {
    const result = computePiecewise(5, [
      bracket("b1", 1, 3, 10),
      bracket("b2", 4, 6, 20),
    ]);
    expect(result.total).toBe(70);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].ordersInBand).toBe(3);
    expect(result.breakdown[1].ordersInBand).toBe(2);
  });

  it("N < first bracket lower bound → 0", () => {
    const result = computePiecewise(2, [bracket("b1", 5, 10, 15)]);
    expect(result.total).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it("N covers only first bracket partially", () => {
    // [1,3]×10, N=2 → count=2 → 20
    const result = computePiecewise(2, [
      bracket("b1", 1, 3, 10),
      bracket("b2", 4, 6, 20),
    ]);
    expect(result.total).toBe(20);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].ordersInBand).toBe(2);
  });

  it("N exactly equals upper bound of first bracket", () => {
    // [1,3]×10, N=3 → count=3 → 30
    const result = computePiecewise(3, [
      bracket("b1", 1, 3, 10),
      bracket("b2", 4, null, 20),
    ]);
    expect(result.total).toBe(30);
    expect(result.breakdown).toHaveLength(1);
  });

  it("unbounded maxOrders (null): absorbs all orders above lower bound", () => {
    // [1,3]×10 + [4,null]×20, N=7 → 3×10 + 4×20 = 110
    const result = computePiecewise(7, [
      bracket("b1", 1, 3, 10),
      bracket("b2", 4, null, 20),
    ]);
    expect(result.total).toBe(110);
    expect(result.breakdown[1].ordersInBand).toBe(4);
  });

  it("single unbounded bracket from 1: all N orders earn rate", () => {
    const result = computePiecewise(5, [bracket("b1", 1, null, 10)]);
    expect(result.total).toBe(50);
    expect(result.breakdown[0].ordersInBand).toBe(5);
  });

  it("gap in bracket schedule: uncovered orders earn 0", () => {
    // [1,2]×10, gap at 3, [4,5]×20 → N=5 → 2×10 + 2×20 = 60
    const result = computePiecewise(5, [
      bracket("b1", 1, 2, 10),
      bracket("b2", 4, 5, 20),
    ]);
    expect(result.total).toBe(60);
    expect(result.breakdown).toHaveLength(2);
  });

  it("all brackets above N → 0", () => {
    const result = computePiecewise(3, [bracket("b1", 10, 20, 50)]);
    expect(result.total).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it("brackets unsorted as input: still produces correct result", () => {
    // Same as spec example but brackets given in reverse order
    const result = computePiecewise(5, [
      bracket("b2", 4, 6, 20),
      bracket("b1", 1, 3, 10),
    ]);
    expect(result.total).toBe(70);
  });

  it("three-bracket schedule: N hits all three", () => {
    // [1,3]×5 + [4,6]×10 + [7,9]×20, N=9 → 3×5 + 3×10 + 3×20 = 105
    const result = computePiecewise(9, [
      bracket("b1", 1, 3, 5),
      bracket("b2", 4, 6, 10),
      bracket("b3", 7, 9, 20),
    ]);
    expect(result.total).toBe(105);
    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown[2].ordersInBand).toBe(3);
  });

  it("breakdown bandTotal rounds to 2 decimal places", () => {
    // 3 × 3.333 = 9.999 → 10.00
    const result = computePiecewise(3, [bracket("b1", 1, null, 3.333)]);
    expect(result.breakdown[0].bandTotal).toBe(10);
    expect(result.total).toBe(10);
  });

  it("breakdown records correct lBound, hBound, ratePerOrder", () => {
    const result = computePiecewise(5, [
      bracket("b1", 1, 3, 10),
      bracket("b2", 4, 6, 20),
    ]);
    expect(result.breakdown[0]).toMatchObject({ lBound: 1, hBound: 3, ratePerOrder: 10 });
    expect(result.breakdown[1]).toMatchObject({ lBound: 4, hBound: 6, ratePerOrder: 20 });
  });
});

// ── bracketsOverlap ───────────────────────────────────────────────────────────

describe("bracketsOverlap", () => {
  it("non-overlapping adjacent brackets: [1,3] and [4,6]", () => {
    expect(bracketsOverlap({ minOrders: 1, maxOrders: 3 }, { minOrders: 4, maxOrders: 6 })).toBe(false);
  });

  it("overlapping brackets: [1,5] and [4,8]", () => {
    expect(bracketsOverlap({ minOrders: 1, maxOrders: 5 }, { minOrders: 4, maxOrders: 8 })).toBe(true);
  });

  it("same range: [1,5] and [1,5]", () => {
    expect(bracketsOverlap({ minOrders: 1, maxOrders: 5 }, { minOrders: 1, maxOrders: 5 })).toBe(true);
  });

  it("first unbounded overlaps second: [1,null] and [5,10]", () => {
    expect(bracketsOverlap({ minOrders: 1, maxOrders: null }, { minOrders: 5, maxOrders: 10 })).toBe(true);
  });

  it("non-overlapping with null: [1,3] and [4,null]", () => {
    expect(bracketsOverlap({ minOrders: 1, maxOrders: 3 }, { minOrders: 4, maxOrders: null })).toBe(false);
  });

  it("both unbounded: [1,null] and [5,null]", () => {
    expect(bracketsOverlap({ minOrders: 1, maxOrders: null }, { minOrders: 5, maxOrders: null })).toBe(true);
  });

  it("touching at single point: [1,4] and [4,8] → overlap", () => {
    // inclusive ranges share index 4
    expect(bracketsOverlap({ minOrders: 1, maxOrders: 4 }, { minOrders: 4, maxOrders: 8 })).toBe(true);
  });
});
