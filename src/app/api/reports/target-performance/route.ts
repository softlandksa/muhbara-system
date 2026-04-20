import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { computePiecewise } from "@/lib/commission-math";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;

  if (
    role !== "ADMIN" &&
    role !== "GENERAL_MANAGER" &&
    role !== "SALES_MANAGER" &&
    role !== "HR"
  ) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const filterTeamId = searchParams.get("teamId");

  // Default to current month
  const now = new Date();
  const periodStart = dateFrom ? new Date(dateFrom) : startOfMonth(now);
  const periodEnd = dateTo ? endOfDay(new Date(dateTo)) : endOfMonth(now);

  // Derive year/month from period start for target lookup
  const targetYear = periodStart.getFullYear();
  const targetMonth = periodStart.getMonth() + 1; // 1–12

  // Delivered status
  const deliveredStatus = await prisma.shippingStatusPrimary.findFirst({
    where: { name: "تم التوصيل" },
  });

  // Build user filter
  const userWhere: Record<string, unknown> = {
    isActive: true,
    role: { in: ["SALES", "SUPPORT", "SALES_MANAGER"] },
  };
  if (role === "SALES_MANAGER" && teamId) userWhere.teamId = teamId;
  if ((role === "ADMIN" || role === "GENERAL_MANAGER" || role === "HR") && filterTeamId) {
    userWhere.teamId = filterTeamId;
  }

  const employees = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      name: true,
      role: true,
      team: { select: { id: true, name: true } },
    },
  });

  // Batch-fetch UserTargets for this month so we don't do N queries
  const userTargets = await prisma.userTarget.findMany({
    where: {
      year: targetYear,
      month: targetMonth,
      userId: { in: employees.map((e) => e.id) },
    },
  });
  const targetByUserId = new Map(userTargets.map((t) => [t.userId, t.targetOrders]));

  // Batch-fetch active FIXED commission rules for piecewise KPI estimation.
  // This is a display-only estimate; authoritative commission amounts are
  // computed by the admin calculate endpoint and stored in Commission records.
  const rules = await prisma.commissionRule.findMany({
    where: { isActive: true, commissionType: "FIXED" },
    include: { currency: { select: { code: true, symbol: true } } },
  });

  // Group rules by (roleType, currencyId) for piecewise scheduling
  const scheduleMap = new Map<string, typeof rules>();
  for (const r of rules) {
    const key = `${r.roleType}:${r.currencyId}`;
    if (!scheduleMap.has(key)) scheduleMap.set(key, []);
    scheduleMap.get(key)!.push(r);
  }

  const results = await Promise.all(
    employees.map(async (emp) => {
      const orderWhere: Record<string, unknown> = {
        deletedAt: null,
        createdById: emp.id,
        orderDate: { gte: periodStart, lte: periodEnd },
      };

      const [totalOrders, deliveredOrders] = await Promise.all([
        prisma.order.count({ where: orderWhere }),
        deliveredStatus
          ? prisma.order.count({ where: { ...orderWhere, statusId: deliveredStatus.id } })
          : Promise.resolve(0),
      ]);

      // Per-user monthly target (separate from commission tiers)
      const targetOrders = targetByUserId.get(emp.id) ?? null;
      const targetAchievement =
        targetOrders && targetOrders > 0
          ? Math.round((deliveredOrders / targetOrders) * 100)
          : null;

      // Piecewise commission KPI (estimate, first matching currency schedule for role)
      let commissionAmount = 0;
      let commissionCurrency: { code: string; symbol: string } | null = null;
      let ruleName: string | null = null;

      for (const [key, brackets] of scheduleMap.entries()) {
        const [scheduleRole] = key.split(":");
        if (scheduleRole !== emp.role) continue;

        const { total } = computePiecewise(
          deliveredOrders,
          brackets.map((b) => ({
            id: b.id,
            name: b.name,
            minOrders: b.minOrders,
            maxOrders: b.maxOrders,
            commissionAmount: b.commissionAmount,
          })),
        );

        if (total > 0) {
          commissionAmount = total;
          commissionCurrency = brackets[0].currency;
          ruleName = brackets.length === 1 ? brackets[0].name : `${brackets.length} شرائح`;
          break; // use first matching currency schedule for display
        }
      }

      return {
        id: emp.id,
        name: emp.name,
        role: emp.role,
        team: emp.team,
        totalOrders,
        deliveredOrders,
        targetOrders,
        targetAchievement,
        commissionAmount,
        commissionCurrency,
        ruleName,
      };
    }),
  );

  return NextResponse.json({
    data: results.sort((a, b) => (b.targetAchievement ?? -1) - (a.targetAchievement ?? -1)),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });
}
