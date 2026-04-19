import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const updateSchema = z.object({
  name:                z.string().min(1, "الاسم مطلوب").max(80).optional(),
  colorOverride:       z.string().regex(/^#[0-9a-fA-F]{6}$/, "لون غير صالح").nullable().optional(),
  sortOrder:           z.number().int().min(0).optional(),
  isActive:            z.boolean().optional(),
  marksOrderDelivered: z.boolean().optional(),
});

function handlePrismaError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: "الاسم مستخدم بالفعل في هذه الحالة الرئيسية" }, { status: 409 });
  }
  console.error("[shipping-status-subs/[id]]", e);
  return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 }); }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" }, { status: 400 });
  }

  const { name, colorOverride, sortOrder, isActive, marksOrderDelivered } = parsed.data;

  const sub = await prisma.shippingStatusSub.findFirst({ where: { id, deletedAt: null } });
  if (!sub) return NextResponse.json({ error: "الحالة الفرعية غير موجودة" }, { status: 404 });

  // Block deactivation when ShippingInfo rows still reference this sub
  if (isActive === false && sub.isActive) {
    const inUse = await prisma.shippingInfo.count({ where: { shippingSubStatusId: id } });
    if (inUse > 0) {
      // Provide sibling active subs as replacement options
      const replacements = await prisma.shippingStatusSub.findMany({
        where: { primaryId: sub.primaryId, isActive: true, deletedAt: null, id: { not: id } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, colorOverride: true },
      });
      return NextResponse.json(
        {
          error: `هذه الحالة مستخدمة في ${inUse} عملية شحن — اختر حالة بديلة لنقل الشحنات إليها`,
          inUse,
          replacements,
        },
        { status: 409 }
      );
    }
  }

  try {
    const updated = await prisma.shippingStatusSub.update({
      where: { id },
      data: {
        ...(name                !== undefined && { name }),
        ...(colorOverride       !== undefined && { colorOverride: colorOverride ?? null }),
        ...(sortOrder           !== undefined && { sortOrder }),
        ...(isActive            !== undefined && { isActive }),
        ...(marksOrderDelivered !== undefined && { marksOrderDelivered }),
        // When deactivating (inUse === 0), also set deletedAt
        ...(isActive === false && { deletedAt: new Date() }),
      },
    });
    return NextResponse.json({ data: updated });
  } catch (e) {
    return handlePrismaError(e);
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;
  const sub = await prisma.shippingStatusSub.findFirst({ where: { id, deletedAt: null } });
  if (!sub) return NextResponse.json({ error: "الحالة الفرعية غير موجودة" }, { status: 404 });

  // Hard-block deletion if ShippingInfo still references this sub
  const inUse = await prisma.shippingInfo.count({ where: { shippingSubStatusId: id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: `لا يمكن الحذف: هذه الحالة مستخدمة في ${inUse} عملية شحن`, inUse },
      { status: 409 }
    );
  }

  await prisma.shippingStatusSub.delete({ where: { id } });
  return NextResponse.json({ data: { success: true } });
}
