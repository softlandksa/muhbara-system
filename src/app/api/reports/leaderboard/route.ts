import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay, startOfMonth, endOfMonth } from "date-fns";

// Leaderboard ranks SALES employees by delivered order count in the period.
// Eligibility: deletedAt IS NULL + shippingInfo.deliveredAt in [periodStart, periodEnd].
// SALES_MANAGER sees only their own team's employees.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId: sessionTeamId } = session.user;

  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const filterTeamId = searchParams.get("teamId");

  const now = new Date();
  const periodStart = dateFrom ? new Date(dateFrom) : startOfMonth(now);
  const periodEnd = dateTo ? endOfDay(new Date(dateTo)) : endOfMonth(now);

  // Build employee filter — SALES_MANAGER is scoped to their own team
  const userWhere: Record<string, unknown> = {
    isActive: true,
    role: "SALES",
  };

  if (role === "SALES_MANAGER") {
    // Resolve manager's teamId (they may not be in session if not set at login)
    const managerTeamId =
      sessionTeamId ??
      (await prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } }))?.teamId;
    if (!managerTeamId) return NextResponse.json({ data: { entries: [], periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() } });
    userWhere.teamId = managerTeamId;
  } else if (filterTeamId) {
    // ADMIN / GENERAL_MANAGER can filter by team
    userWhere.teamId = filterTeamId;
  }

  const employees = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      name: true,
      team: { select: { id: true, name: true } },
    },
  });

  if (employees.length === 0) {
    return NextResponse.json({
      data: { entries: [], periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
    });
  }

  const employeeIds = employees.map((e) => e.id);

  // Single query: fetch all delivered orders for all employees in the period.
  // Counting and grouping done in memory to avoid N+1 and work around
  // Prisma groupBy limitations with relation-based WHERE clauses.
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      createdById: { in: employeeIds },
      shippingInfo: { deliveredAt: { gte: periodStart, lte: periodEnd } },
    },
    select: {
      createdById: true,
      totalAmount: true,
      currency: { select: { id: true, code: true, symbol: true } },
    },
  });

  // Aggregate per employee
  type CurrencyAgg = { id: string; code: string; symbol: string; total: number };
  const byEmp = new Map<string, { count: number; currencies: Map<string, CurrencyAgg> }>();

  for (const emp of employees) {
    byEmp.set(emp.id, { count: 0, currencies: new Map() });
  }
  for (const order of orders) {
    if (!order.createdById) continue;
    const agg = byEmp.get(order.createdById);
    if (!agg) continue;
    agg.count++;
    const cur = order.currency;
    if (!agg.currencies.has(cur.id)) {
      agg.currencies.set(cur.id, { id: cur.id, code: cur.code, symbol: cur.symbol, total: 0 });
    }
    agg.currencies.get(cur.id)!.total += order.totalAmount;
  }

  // Batch fetch UserTargets for the period's month
  const targetYear = periodStart.getFullYear();
  const targetMonth = periodStart.getMonth() + 1;
  const targets = await prisma.userTarget.findMany({
    where: { userId: { in: employeeIds }, year: targetYear, month: targetMonth },
  });
  const targetMap = new Map(targets.map((t) => [t.userId, t.targetOrders]));

  // Build ranked entries — sort by count desc, then total revenue desc (sum across currencies), then name
  const entries = employees
    .map((emp) => {
      const agg = byEmp.get(emp.id)!;
      const revenueByCurrency = [...agg.currencies.values()].map((c) => ({
        ...c,
        total: Math.round(c.total * 100) / 100,
      }));
      const totalRevenue = revenueByCurrency.reduce((s, c) => s + c.total, 0);
      const targetOrders = targetMap.get(emp.id) ?? null;
      const targetAchievement =
        targetOrders && targetOrders > 0
          ? Math.round((agg.count / targetOrders) * 100)
          : null;
      return {
        userId: emp.id,
        name: emp.name,
        team: emp.team,
        orderCount: agg.count,
        revenueByCurrency,
        totalRevenue,
        targetOrders,
        targetAchievement,
      };
    })
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
      if (b.totalRevenue !== a.totalRevenue) return b.totalRevenue - a.totalRevenue;
      return a.name.localeCompare(b.name, "ar");
    })
    .map((entry, i) => ({ rank: i + 1, ...entry }));

  return NextResponse.json({
    data: {
      entries,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    },
  });
}
