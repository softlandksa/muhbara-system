import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay, startOfMonth, endOfMonth } from "date-fns";

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

  // Batch-fetch active commission rules (for tier matching)
  const rules = await prisma.commissionRule.findMany({
    where: { isActive: true },
    include: { currency: { select: { code: true, symbol: true } } },
  });

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

      // Match commission tier (independent of target)
      const empRule = rules.find(
        (r) =>
          r.roleType === emp.role &&
          deliveredOrders >= r.minOrders &&
          (r.maxOrders === null || deliveredOrders <= r.maxOrders),
      );

      let commissionAmount = 0;
      if (empRule) {
        if (empRule.commissionType === "FIXED") {
          commissionAmount = empRule.commissionAmount;
        } else {
          const revenueAgg = await prisma.order.aggregate({
            where: { ...orderWhere, statusId: deliveredStatus?.id },
            _sum: { totalAmount: true },
          });
          commissionAmount =
            ((revenueAgg._sum.totalAmount ?? 0) * empRule.commissionAmount) / 100;
        }
        commissionAmount = Math.round(commissionAmount * 100) / 100;
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
        commissionCurrency: empRule?.currency ?? null,
        ruleName: empRule?.name ?? null,
      };
    }),
  );

  return NextResponse.json({
    data: results.sort((a, b) => (b.targetAchievement ?? -1) - (a.targetAchievement ?? -1)),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });
}
