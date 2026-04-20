import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { computePiecewise, type CommissionBracket } from "@/lib/commission-math";

// Personal dashboard data for SALES employees.
// Period: current calendar month by default (overridable via dateFrom/dateTo).
// Returns: global rank among all SALES, target progress, commission breakdown.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;

  if (role !== "SALES") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const now = new Date();
  const periodStart = dateFrom ? new Date(dateFrom) : startOfMonth(now);
  const periodEnd = dateTo ? endOfDay(new Date(dateTo)) : endOfMonth(now);

  // ── 1. Count my delivered orders ────────────────────────────────────────────
  const myOrderCount = await prisma.order.count({
    where: {
      deletedAt: null,
      createdById: userId,
      shippingInfo: { deliveredAt: { gte: periodStart, lte: periodEnd } },
    },
  });

  // ── 2. Global rank among all active SALES employees ─────────────────────────
  // Count how many SALES employees delivered MORE orders than me in this period.
  // rank = (employees with more deliveries) + 1
  // We do this with a single aggregated query: count orders per SALES user,
  // then compare. For efficiency, fetch order counts in one shot.
  const allSalesUsers = await prisma.user.findMany({
    where: { isActive: true, role: "SALES" },
    select: { id: true },
  });
  const allSalesIds = allSalesUsers.map((u) => u.id);

  // Get counts for all SALES employees in a single query
  const allOrders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      createdById: { in: allSalesIds },
      shippingInfo: { deliveredAt: { gte: periodStart, lte: periodEnd } },
    },
    select: { createdById: true },
  });

  const countPerUser = new Map<string, number>();
  for (const o of allOrders) {
    if (!o.createdById) continue;
    countPerUser.set(o.createdById, (countPerUser.get(o.createdById) ?? 0) + 1);
  }

  // Employees with more deliveries than me
  const myCount = countPerUser.get(userId) ?? 0;
  const higherCount = [...countPerUser.values()].filter((c) => c > myCount).length;
  const myRank = myCount > 0 ? higherCount + 1 : null;
  const totalInRank = allSalesIds.length;

  // ── 3. Monthly target ────────────────────────────────────────────────────────
  const targetYear = periodStart.getFullYear();
  const targetMonth = periodStart.getMonth() + 1;
  const userTarget = await prisma.userTarget.findUnique({
    where: { userId_year_month: { userId, year: targetYear, month: targetMonth } },
  });
  const targetOrders = userTarget?.targetOrders ?? null;
  const targetAchievement =
    targetOrders && targetOrders > 0
      ? Math.round((myOrderCount / targetOrders) * 100)
      : null;

  // ── 4. Commission breakdown (piecewise) ─────────────────────────────────────
  const rules = await prisma.commissionRule.findMany({
    where: { isActive: true, commissionType: "FIXED", roleType: "SALES" },
    include: { currency: { select: { id: true, code: true, symbol: true } } },
    orderBy: { minOrders: "asc" },
  });

  // Group by currencyId — use first currency schedule found
  const scheduleMap = new Map<string, CommissionBracket[]>();
  for (const r of rules) {
    if (!scheduleMap.has(r.currencyId)) scheduleMap.set(r.currencyId, []);
    scheduleMap.get(r.currencyId)!.push({
      id: r.id,
      name: r.name,
      minOrders: r.minOrders,
      maxOrders: r.maxOrders,
      commissionAmount: r.commissionAmount,
    });
  }

  let commissionBreakdown: {
    ruleId: string;
    ruleName: string;
    lBound: number;
    hBound: number | null;
    ordersInBand: number;
    ratePerOrder: number;
    bandTotal: number;
    currencyCode: string;
    currencySymbol: string;
  }[] = [];
  let commissionTotal = 0;
  let commissionCurrencyCode: string | null = null;
  let commissionCurrencySymbol: string | null = null;

  // Use first matching currency schedule (consistent with leaderboard and target-performance)
  for (const [currencyId, brackets] of scheduleMap.entries()) {
    const { total, breakdown } = computePiecewise(myOrderCount, brackets);
    const currencyRule = rules.find((r) => r.currencyId === currencyId);
    commissionBreakdown = breakdown.map((b) => ({
      ...b,
      currencyCode: currencyRule?.currency.code ?? "",
      currencySymbol: currencyRule?.currency.symbol ?? "",
    }));
    commissionTotal = total;
    commissionCurrencyCode = currencyRule?.currency.code ?? null;
    commissionCurrencySymbol = currencyRule?.currency.symbol ?? null;
    break; // use first schedule
  }

  return NextResponse.json({
    data: {
      orderCount: myOrderCount,
      rank: myRank,
      totalInRank,
      targetOrders,
      targetAchievement,
      commissionBreakdown,
      commissionTotal,
      commissionCurrencyCode,
      commissionCurrencySymbol,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    },
  });
}
