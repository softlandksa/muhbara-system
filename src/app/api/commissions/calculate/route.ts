import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNotificationsForRole } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";
import { endOfDay } from "date-fns";
import { computePiecewise, type CommissionBracket } from "@/lib/commission-math";
import { buildDeliveredWhere } from "@/lib/order-eligibility";

// Commission-eligible roles (one tier schedule per role+currency, no mixing).
const COMMISSION_ROLES = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"] as const;

const calcSchema = z.object({
  periodStart: z.string().min(1, "تاريخ البداية مطلوب"),
  periodEnd:   z.string().min(1, "تاريخ النهاية مطلوب"),
});

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
    // Only FIXED rules participate in piecewise per-order calculation.
    // PERCENTAGE rules are not compatible with the marginal bracket model.
    const allRules = await prisma.commissionRule.findMany({
      where: { isActive: true, commissionType: "FIXED" },
    });
    if (allRules.length === 0) {
      return NextResponse.json({ error: "لا توجد قواعد عمولات نشطة (نوع ثابت لكل طلب)" }, { status: 400 });
    }

    // Group brackets by (roleType, currencyId) — each group is one bracket schedule.
    // Multi-currency: one Commission record per (employee, currencyId group).
    const schedules = new Map<string, CommissionBracket[]>();
    for (const r of allRules) {
      const key = `${r.roleType}:${r.currencyId}`;
      if (!schedules.has(key)) schedules.set(key, []);
      schedules.get(key)!.push({
        id: r.id,
        name: r.name,
        minOrders: r.minOrders,
        maxOrders: r.maxOrders,
        commissionAmount: r.commissionAmount,
      });
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

        // Idempotent: delete all existing PENDING commissions for this user+period
        await tx.commission.deleteMany({
          where: { userId: emp.id, periodStart, periodEnd, status: "PENDING" },
        });

        if (deliveredCount === 0) continue;

        // Apply each currency schedule for this role independently
        for (const [key, brackets] of schedules.entries()) {
          const [scheduleRole, currencyId] = key.split(":");
          if (scheduleRole !== emp.role) continue;

          const { total, breakdown } = computePiecewise(deliveredCount, brackets);
          if (total <= 0) continue;

          await tx.commission.create({
            data: {
              userId:               emp.id,
              periodStart,
              periodEnd,
              totalDeliveredOrders: deliveredCount,
              ruleId:               null,  // piecewise: no single primary rule
              breakdown:            breakdown as object[],
              commissionAmount:     total,
              currencyId,
              status:               "PENDING",
            },
          });
          created.push({ userId: emp.id, name: emp.name, amount: total });
        }
      }

      if (created.length > 0) {
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
