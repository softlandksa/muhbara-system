/**
 * GET /api/reports/targets
 *
 * Returns EmployeeTargets enriched with "achieved" delivered-order counts
 * using the same per-role scope as the commission calculation.
 *
 * Visibility by session role:
 *  - SALES / SHIPPING / FOLLOWUP : own targets only
 *  - SALES_MANAGER               : own + all team-members' targets
 *  - ADMIN / GENERAL_MANAGER     : all targets (optional ?userId / ?teamId filter)
 *
 * Query params (all optional):
 *   periodStart  – filter targets whose periodStart >= this date
 *   periodEnd    – filter targets whose periodEnd   <= this date
 *   userId       – (ADMIN/GM only) filter to a specific user
 *   teamId       – (ADMIN/GM only) filter to a specific team
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const COMMISSION_ROLES = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"] as const;

/** Same scope logic as calculate/route.ts buildDeliveredWhere */
function buildDeliveredWhere(
  emp: { id: string; role: string; teamId: string | null },
  periodStart: Date,
  periodEnd: Date,
): Prisma.OrderWhereInput | null {
  const deliveredAt: Prisma.DateTimeFilter = { gte: periodStart, lte: periodEnd };

  switch (emp.role) {
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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;

  const allowed = [...COMMISSION_ROLES as readonly string[], "ADMIN"];
  if (!allowed.includes(role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const qPeriodStart = searchParams.get("periodStart");
  const qPeriodEnd   = searchParams.get("periodEnd");
  const filterUserId = searchParams.get("userId");
  const filterTeamId = searchParams.get("teamId");

  // ── Build target WHERE ──────────────────────────────────────────────────────
  const targetWhere: Prisma.EmployeeTargetWhereInput = {};

  if (role === "ADMIN" || role === "GENERAL_MANAGER") {
    if (filterUserId) targetWhere.userId = filterUserId;
    if (filterTeamId) targetWhere.user = { teamId: filterTeamId };
  } else if (role === "SALES_MANAGER") {
    // Own targets + team-members' targets
    const memberConditions: Prisma.EmployeeTargetWhereInput[] = [{ userId }];
    if (teamId) memberConditions.push({ user: { teamId } });
    targetWhere.OR = memberConditions;
    if (filterUserId) targetWhere.userId = filterUserId; // refine to a specific member
  } else {
    // SALES / SHIPPING / FOLLOWUP: own only (ignore client filter)
    targetWhere.userId = userId;
  }

  if (qPeriodStart) targetWhere.periodStart = { gte: new Date(qPeriodStart) };
  if (qPeriodEnd)   targetWhere.periodEnd   = { lte: new Date(qPeriodEnd) };

  try {
    const targets = await prisma.employeeTarget.findMany({
      where: targetWhere,
      include: {
        user:     { select: { id: true, name: true, role: true, teamId: true, team: { select: { id: true, name: true } } } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
      orderBy: [{ periodStart: "desc" }, { user: { name: "asc" } }],
    });

    // Enrich each target with achieved delivered count for its period + user scope
    const enriched = await Promise.all(
      targets.map(async (t) => {
        const where = buildDeliveredWhere(
          { id: t.userId, role: t.user.role, teamId: t.user.teamId },
          t.periodStart,
          t.periodEnd,
        );
        const achievedDelivered = where ? await prisma.order.count({ where }) : 0;

        const orderPct =
          t.targetDeliveredOrderCount && t.targetDeliveredOrderCount > 0
            ? Math.round((achievedDelivered / t.targetDeliveredOrderCount) * 100)
            : null;

        return { ...t, achievedDelivered, orderPct };
      }),
    );

    return NextResponse.json({ data: enriched });
  } catch (e) {
    console.error("[reports/targets GET]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}
