import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const WRITE_ROLES = ["ADMIN", "GENERAL_MANAGER"] as const;
const COMMISSION_ROLES = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"] as const;

const createSchema = z.object({
  userId:                    z.string().min(1, "المستخدم مطلوب"),
  periodStart:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ البداية غير صالح"),
  periodEnd:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ النهاية غير صالح"),
  targetDeliveredOrderCount: z.number().int().min(0).nullable().optional(),
  targetRevenue:             z.number().min(0).nullable().optional(),
  currencyId:                z.string().nullable().optional(),
  notes:                     z.string().max(500).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;

  // ADMIN/GM see all; SALES_MANAGER sees own team; others see own targets
  const allowed = [...COMMISSION_ROLES as readonly string[], "ADMIN"];
  if (!allowed.includes(role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filterUserId  = searchParams.get("userId");
  const periodStart   = searchParams.get("periodStart");
  const periodEnd     = searchParams.get("periodEnd");

  const where: Prisma.EmployeeTargetWhereInput = {};

  if (role === "ADMIN" || role === "GENERAL_MANAGER") {
    if (filterUserId) where.userId = filterUserId;
  } else if (role === "SALES_MANAGER") {
    // Only own targets or team-members' targets
    if (teamId) {
      where.user = { OR: [{ id: userId }, { teamId }] };
    } else {
      where.userId = userId;
    }
    if (filterUserId) where.userId = filterUserId;
  } else {
    // SALES / SHIPPING / FOLLOWUP: own targets only, ignore client filter
    where.userId = userId;
  }

  if (periodStart) where.periodStart = { gte: new Date(periodStart) };
  if (periodEnd)   where.periodEnd   = { lte: new Date(periodEnd) };

  try {
    const targets = await prisma.employeeTarget.findMany({
      where,
      include: {
        user:     { select: { id: true, name: true, role: true, team: { select: { id: true, name: true } } } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
      orderBy: [{ periodStart: "desc" }, { user: { name: "asc" } }],
    });
    return NextResponse.json({ data: targets });
  } catch (e) {
    console.error("[admin/targets GET]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!(WRITE_ROLES as readonly string[]).includes(session.user.role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }

  const { userId, periodStart, periodEnd, targetDeliveredOrderCount, targetRevenue, currencyId, notes } = parsed.data;

  if (periodStart > periodEnd) {
    return NextResponse.json({ error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية" }, { status: 400 });
  }

  // Validate target user exists and has an eligible role
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!targetUser || !targetUser.isActive) {
    return NextResponse.json({ error: "المستخدم غير موجود أو غير نشط" }, { status: 404 });
  }
  if (!(COMMISSION_ROLES as readonly string[]).includes(targetUser.role)) {
    return NextResponse.json({ error: "دور المستخدم غير مؤهل للتارجت" }, { status: 400 });
  }

  try {
    const target = await prisma.employeeTarget.create({
      data: {
        userId,
        periodStart:               new Date(periodStart),
        periodEnd:                 new Date(periodEnd),
        targetDeliveredOrderCount: targetDeliveredOrderCount ?? null,
        targetRevenue:             targetRevenue ?? null,
        currencyId:                currencyId ?? null,
        notes:                     notes ?? null,
      },
      include: {
        user:     { select: { id: true, name: true, role: true } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
    });
    return NextResponse.json({ data: target }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "يوجد تارجت لهذا الموظف في نفس الفترة" }, { status: 409 });
    }
    console.error("[admin/targets POST]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}
