import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const updateSchema = z.object({
  name:      z.string().min(1, "الاسم مطلوب").max(80).optional(),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/, "لون غير صالح").optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive:  z.boolean().optional(),
});

function handlePrismaError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: "الاسم مستخدم بالفعل" }, { status: 409 });
  }
  console.error("[shipping-statuses/[id]]", e);
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

  const { name, color, sortOrder, isActive } = parsed.data;

  const status = await prisma.shippingStatusPrimary.findFirst({
    where: { id, deletedAt: null },
  });
  if (!status) {
    return NextResponse.json({ error: "حالة الشحن غير موجودة" }, { status: 404 });
  }

  // Block deactivation if primary has active subs
  if (isActive === false && status.isActive) {
    const activeSubs = await prisma.shippingStatusSub.count({
      where: { primaryId: id, isActive: true, deletedAt: null },
    });
    if (activeSubs > 0) {
      return NextResponse.json(
        { error: `يجب تعطيل جميع الحالات الفرعية أولاً (${activeSubs} حالة فرعية نشطة)`, activeSubs },
        { status: 409 }
      );
    }
  }

  try {
    const updated = await prisma.shippingStatusPrimary.update({
      where: { id },
      data: {
        ...(name      !== undefined && { name }),
        ...(color     !== undefined && { color }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive  !== undefined && { isActive }),
      },
      include: {
        subs: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      },
    });
    return NextResponse.json({ data: updated });
  } catch (e) {
    return handlePrismaError(e);
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;

  // Load primary with all sub IDs (including already-soft-deleted ones still in DB)
  const status = await prisma.shippingStatusPrimary.findFirst({
    where: { id, deletedAt: null },
    include: { subs: { select: { id: true } } },
  });
  if (!status) {
    return NextResponse.json({ error: "حالة الشحن غير موجودة" }, { status: 404 });
  }

  // Block deletion if any orders use this primary status
  const ordersCount = await prisma.order.count({
    where: { statusId: id, deletedAt: null },
  });
  if (ordersCount > 0) {
    return NextResponse.json(
      { error: `لا يمكن الحذف: هذه الحالة مستخدمة في ${ordersCount} طلب`, ordersCount },
      { status: 409 }
    );
  }

  const subIds = status.subs.map((s) => s.id);

  // Count ShippingInfo records referencing any sub under this primary
  const shippingInfoCount =
    subIds.length > 0
      ? await prisma.shippingInfo.count({ where: { shippingSubStatusId: { in: subIds } } })
      : 0;

  // Try to parse optional body — DELETE may carry { replacementSubId } for the migration flow
  let replacementSubId: string | undefined;
  try {
    const body = (await request.json()) as { replacementSubId?: string } | null;
    replacementSubId = body?.replacementSubId ?? undefined;
  } catch {
    // No body or non-JSON body — treat as plain delete request
  }

  if (shippingInfoCount > 0 && !replacementSubId) {
    // Return active subs from OTHER primaries as replacement candidates
    const replacements = await prisma.shippingStatusSub.findMany({
      where: { isActive: true, deletedAt: null, primaryId: { not: id } },
      select: { id: true, name: true, primary: { select: { name: true } } },
      orderBy: [{ primary: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    });
    return NextResponse.json(
      {
        error: `لا يمكن الحذف: هناك ${shippingInfoCount} شحنة مرتبطة بحالات فرعية تابعة لهذه الحالة. اختر حالة فرعية بديلة لنقل الشحنات إليها.`,
        inUse: shippingInfoCount,
        replacements: replacements.map((r) => ({
          id: r.id,
          name: r.name,
          primaryName: r.primary.name,
        })),
      },
      { status: 409 }
    );
  }

  // Validate the replacement sub when provided
  if (replacementSubId) {
    if (subIds.includes(replacementSubId)) {
      return NextResponse.json(
        { error: "لا يمكن استخدام حالة فرعية من نفس الحالة الرئيسية بديلاً" },
        { status: 400 }
      );
    }
    const replacementSub = await prisma.shippingStatusSub.findFirst({
      where: { id: replacementSubId, isActive: true, deletedAt: null },
    });
    if (!replacementSub) {
      return NextResponse.json(
        { error: "الحالة البديلة غير موجودة أو غير نشطة" },
        { status: 400 }
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (subIds.length > 0) {
        // Migrate or null-out ShippingInfo references before hard-deleting subs
        await tx.shippingInfo.updateMany({
          where: { shippingSubStatusId: { in: subIds } },
          data: { shippingSubStatusId: replacementSubId ?? null },
        });
        // Hard-delete all subs — removes FK children so the primary can be deleted
        await tx.shippingStatusSub.deleteMany({ where: { primaryId: id } });
      }
      await tx.shippingStatusPrimary.delete({ where: { id } });
    });
  } catch (e) {
    console.error("[shipping-statuses/[id] DELETE]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }

  return NextResponse.json({ data: { success: true } });
}
