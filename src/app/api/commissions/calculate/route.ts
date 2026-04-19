import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNotificationsForRole } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";
import { endOfDay } from "date-fns";

// Commission-eligible roles (one tier set per role, no mixing).
const COMMISSION_ROLES = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"] as const;
type CommissionRole = (typeof COMMISSION_ROLES)[number];

const calcSchema = z.object({
  periodStart: z.string().min(1, "تاريخ البداية مطلوب"),
  periodEnd:   z.string().min(1, "تاريخ النهاية مطلوب"),
});

/**
 * Builds the Order WHERE clause for counting delivered orders per role scope.
 *
 * Countable order = ShippingInfo.deliveredAt falls within [periodStart, periodEnd].
 * Each role has a distinct attribution scope:
 *  - SALES       : createdById = user (orders the employee created)
 *  - SHIPPING     : shippingInfo.shippedById = user (orders the employee physically shipped)
 *  - FOLLOWUP     : at least one FollowUpNote by user on the order (orders they worked on);
 *                   consistent with the follow-up board which shows all orders to FOLLOWUP users
 *  - SALES_MANAGER: order.teamId = user.teamId (any member of the team)
 *  - GENERAL_MANAGER: all delivered orders system-wide
 *
 * Returns null to signal "skip this employee" (e.g. SALES_MANAGER without a team).
 */
function buildDeliveredWhere(
  emp: { id: string; role: string; teamId: string | null },
  periodStart: Date,
  periodEnd: Date,
): Record<string, unknown> | null {
  const deliveredAt = { gte: periodStart, lte: periodEnd };

  switch (emp.role as CommissionRole) {
    case "SALES":
      return { deletedAt: null, createdById: emp.id, shippingInfo: { deliveredAt } };

    case "SHIPPING":
      return {
        deletedAt: null,
        shippingInfo: { shippedById: emp.id, deliveredAt },
      };

    case "FOLLOWUP":
      // Attribution: orders where this FOLLOWUP user added at least one follow-up note.
      // Consistent with the /follow-up board (FOLLOWUP role sees all orders; commission
      // only counts those they personally worked on).
      return {
        deletedAt: null,
        followUpNotes: { some: { createdById: emp.id } },
        shippingInfo: { deliveredAt },
      };

    case "SALES_MANAGER":
      if (!emp.teamId) return null; // no team → skip
      return { deletedAt: null, teamId: emp.teamId, shippingInfo: { deliveredAt } };

    case "GENERAL_MANAGER":
      return { deletedAt: null, shippingInfo: { deliveredAt } };

    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  const { id: adminId } = session.user;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }

  const parsed = calcSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const periodStart = new Date(parsed.data.periodStart);
  const periodEnd   = endOfDay(new Date(parsed.data.periodEnd));

  if (periodStart > periodEnd) {
    return NextResponse.json({ error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية" }, { status: 400 });
  }

  try {
    const rules = await prisma.commissionRule.findMany({ where: { isActive: true } });
    if (rules.length === 0) {
      return NextResponse.json({ error: "لا توجد قواعد عمولات نشطة" }, { status: 400 });
    }

    const employees = await prisma.user.findMany({
      where: { isActive: true, role: { in: [...COMMISSION_ROLES] as import("@prisma/client").Role[] } },
      select: { id: true, name: true, role: true, teamId: true },
    });

    const created: { userId: string; name: string; amount: number }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const emp of employees) {
        const where = buildDeliveredWhere(emp, periodStart, periodEnd);
        if (!where) continue; // SALES_MANAGER without team, etc.

        const deliveredCount = await tx.order.count({ where });
        if (deliveredCount === 0) continue;

        const matchingRule = rules.find(
          (r) =>
            r.roleType === emp.role &&
            deliveredCount >= r.minOrders &&
            (r.maxOrders === null || deliveredCount <= r.maxOrders),
        );
        if (!matchingRule) continue;

        // PERCENTAGE base = total revenue of delivered orders in this employee's scope
        let amount = matchingRule.commissionAmount;
        if (matchingRule.commissionType === "PERCENTAGE") {
          const agg = await tx.order.aggregate({ where, _sum: { totalAmount: true } });
          amount = ((agg._sum.totalAmount ?? 0) * matchingRule.commissionAmount) / 100;
        }

        // Idempotent: delete any existing PENDING commission for this user+period,
        // then insert a fresh one so re-running recalculates correctly.
        await tx.commission.deleteMany({
          where: { userId: emp.id, periodStart, periodEnd, status: "PENDING" },
        });

        await tx.commission.create({
          data: {
            userId:               emp.id,
            periodStart,
            periodEnd,
            totalDeliveredOrders: deliveredCount,
            ruleId:               matchingRule.id,
            commissionAmount:     Math.round(amount * 100) / 100,
            currencyId:           matchingRule.currencyId,
            status:               "PENDING",
          },
        });
        created.push({ userId: emp.id, name: emp.name, amount });
      }

      if (created.length > 0) {
        // Notify each eligible role group
        for (const r of COMMISSION_ROLES) {
          await createNotificationsForRole(tx, {
            role: r,
            title: "تم حساب العمولات",
            message: `تم حساب عمولتك لفترة ${parsed.data.periodStart} — ${parsed.data.periodEnd}`,
            type: "COMMISSION",
          });
        }
      }

      await logActivity(tx, {
        userId: adminId,
        action: "CALCULATE_COMMISSIONS",
        entityType: "Commission",
        details: {
          periodStart: parsed.data.periodStart,
          periodEnd:   parsed.data.periodEnd,
          count:       created.length,
        },
      });
    });

    return NextResponse.json({ data: { calculated: created.length } }, { status: 201 });
  } catch (e) {
    console.error("[commissions/calculate]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}
