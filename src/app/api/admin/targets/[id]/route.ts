import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const WRITE_ROLES = ["ADMIN", "GENERAL_MANAGER"] as const;

const updateSchema = z.object({
  periodStart:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  targetDeliveredOrderCount: z.number().int().min(0).nullable().optional(),
  targetRevenue:             z.number().min(0).nullable().optional(),
  currencyId:                z.string().nullable().optional(),
  notes:                     z.string().max(500).nullable().optional(),
});

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!(WRITE_ROLES as readonly string[]).includes(session.user.role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }

  const { periodStart, periodEnd, ...rest } = parsed.data;

  try {
    const target = await prisma.employeeTarget.update({
      where: { id },
      data: {
        ...(periodStart && { periodStart: new Date(periodStart) }),
        ...(periodEnd   && { periodEnd:   new Date(periodEnd) }),
        ...rest,
      },
      include: {
        user:     { select: { id: true, name: true, role: true } },
        currency: { select: { id: true, code: true, symbol: true } },
      },
    });
    return NextResponse.json({ data: target });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return NextResponse.json({ error: "التارجت غير موجود" }, { status: 404 });
      if (e.code === "P2002") return NextResponse.json({ error: "يوجد تارجت لهذا الموظف في نفس الفترة" }, { status: 409 });
    }
    console.error("[admin/targets/[id] PUT]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!(WRITE_ROLES as readonly string[]).includes(session.user.role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id } = await ctx.params;

  try {
    await prisma.employeeTarget.delete({ where: { id } });
    return NextResponse.json({ data: { success: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "التارجت غير موجود" }, { status: 404 });
    }
    console.error("[admin/targets/[id] DELETE]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}
