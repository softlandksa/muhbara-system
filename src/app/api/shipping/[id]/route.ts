import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

const updateSchema = z.object({
  subStatusId:       z.string().min(1, "الحالة مطلوبة"),
  shippingCompanyId: z.string().optional(),
  trackingNumber:    z.string().optional(),
});

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;
  if (role !== "ADMIN" && role !== "SHIPPING") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  // id here is ShippingInfo.id
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 }
    );
  }

  const { subStatusId, shippingCompanyId, trackingNumber } = parsed.data;

  const shippingInfo = await prisma.shippingInfo.findUnique({
    where: { id },
    include: {
      order: { include: { status: { select: { name: true } } } },
    },
  });
  if (!shippingInfo) return NextResponse.json({ error: "معلومات الشحن غير موجودة" }, { status: 404 });

  const sub = await prisma.shippingStatusSub.findUnique({
    where: { id: subStatusId },
    include: { primary: true },
  });
  if (!sub) return NextResponse.json({ error: "الحالة غير موجودة" }, { status: 404 });

  const isDelivered = sub.marksOrderDelivered;

  const result = await prisma.$transaction(async (tx) => {
    const updatedShipping = await tx.shippingInfo.update({
      where: { id },
      data: {
        shippingSubStatusId: subStatusId,
        ...(shippingCompanyId && { shippingCompanyId }),
        ...(trackingNumber !== undefined && { trackingNumber: trackingNumber.trim() || null }),
        ...(isDelivered && { deliveredAt: new Date() }),
      },
      include: {
        shippingCompany: true,
        shippingSubStatus: {
          include: { primary: true },
        },
      },
    });

    // Update order's primary status
    await tx.order.update({
      where: { id: shippingInfo.orderId },
      data: { statusId: sub.primaryId },
    });

    await tx.orderAuditLog.create({
      data: {
        orderId:     shippingInfo.orderId,
        action:      "STATUS_CHANGE",
        fieldName:   "status",
        oldValue:    shippingInfo.order.status.name,
        newValue:    sub.name,
        changedById: userId,
        changedAt:   new Date(),
      },
    });

    await logActivity(tx, {
      userId,
      action:     "UPDATE_ORDER_STATUS",
      entityType: "Order",
      entityId:   shippingInfo.orderId,
      details:    { subStatus: sub.name, primary: sub.primary.name, isDelivered },
    });

    return { ...updatedShipping, isDelivered };
  });

  return NextResponse.json({ data: result });
}
