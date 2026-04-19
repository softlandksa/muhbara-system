import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

const bulkUpdateSchema = z.object({
  orderIds:    z.array(z.string().min(1)).min(1, "يجب تحديد طلب واحد على الأقل"),
  subStatusId: z.string().min(1, "الحالة مطلوبة"),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;
  if (role !== "ADMIN" && role !== "SHIPPING") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const parsed = bulkUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 }
    );
  }

  const { orderIds, subStatusId } = parsed.data;

  const sub = await prisma.shippingStatusSub.findUnique({
    where: { id: subStatusId },
    include: { primary: true },
  });
  if (!sub) {
    return NextResponse.json({ error: "الحالة غير موجودة" }, { status: 404 });
  }

  const isDelivered = sub.marksOrderDelivered;

  let updatedCount = 0;
  const errors: { orderId: string; message: string }[] = [];

  for (const orderId of orderIds) {
    try {
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirst({
          where: { id: orderId, deletedAt: null },
          include: {
            status: { select: { name: true } },
            shippingInfo: { select: { id: true } },
          },
        });
        if (!order) throw new Error("الطلب غير موجود");

        // Update order's primary status
        await tx.order.update({
          where: { id: orderId },
          data: { statusId: sub.primaryId },
        });

        // Update ShippingInfo sub-status and optionally deliveredAt
        if (order.shippingInfo) {
          await tx.shippingInfo.update({
            where: { id: order.shippingInfo.id },
            data: {
              shippingSubStatusId: subStatusId,
              ...(isDelivered && { deliveredAt: new Date() }),
            },
          });
        }

        await tx.orderAuditLog.create({
          data: {
            orderId,
            action:      "STATUS_CHANGE",
            fieldName:   "status",
            oldValue:    order.status.name,
            newValue:    sub.name,
            changedById: userId,
            changedAt:   new Date(),
          },
        });

        await logActivity(tx, {
          userId,
          action:     "UPDATE_ORDER_STATUS",
          entityType: "Order",
          entityId:   orderId,
          details:    { subStatus: sub.name, primary: sub.primary.name, bulk: true },
        });
      });
      updatedCount++;
    } catch (err) {
      errors.push({
        orderId,
        message: err instanceof Error ? err.message : "خطأ غير متوقع",
      });
    }
  }

  return NextResponse.json({ data: { updatedCount, errors } });
}
