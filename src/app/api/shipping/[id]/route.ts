import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

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
  const body = await request.json();
  const { subStatusId } = body;
  if (!subStatusId) {
    return NextResponse.json({ error: "الحالة مطلوبة" }, { status: 400 });
  }

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
