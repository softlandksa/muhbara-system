import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

const bulkUpdateSchema = z.object({
  orderIds:          z.array(z.string().min(1)).min(1, "يجب تحديد طلب واحد على الأقل"),
  subStatusId:       z.string().min(1, "الحالة مطلوبة"),
  shippingCompanyId: z.string().min(1).optional(),
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

  const { orderIds, subStatusId, shippingCompanyId } = parsed.data;

  const [sub, shippingCompany] = await Promise.all([
    prisma.shippingStatusSub.findUnique({
      where: { id: subStatusId },
      include: { primary: true },
    }),
    shippingCompanyId
      ? prisma.shippingCompany.findUnique({ where: { id: shippingCompanyId } })
      : Promise.resolve(null),
  ]);

  if (!sub) {
    return NextResponse.json({ error: "الحالة غير موجودة" }, { status: 404 });
  }
  if (shippingCompanyId && !shippingCompany) {
    return NextResponse.json({ error: "شركة الشحن غير موجودة" }, { status: 404 });
  }

  const isDelivered = sub.marksOrderDelivered;
  const now = new Date();

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
        if (!order) throw new Error(`الطلب ${orderId} غير موجود`);

        await tx.order.update({
          where: { id: orderId },
          data: { statusId: sub.primaryId },
        });

        if (order.shippingInfo) {
          await tx.shippingInfo.update({
            where: { id: order.shippingInfo.id },
            data: {
              shippingSubStatusId: subStatusId,
              ...(isDelivered && { deliveredAt: now }),
              ...(shippingCompanyId && { shippingCompanyId }),
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
            changedAt:   now,
          },
        });

        await logActivity(tx, {
          userId,
          action:     "UPDATE_ORDER_STATUS",
          entityType: "Order",
          entityId:   orderId,
          details:    {
            subStatus: sub.name,
            primary:   sub.primary.name,
            bulk:      true,
            ...(shippingCompanyId && { shippingCompanyId, shippingCompanyName: shippingCompany?.name }),
          },
        });
      });
      updatedCount++;
    } catch (err) {
      errors.push({ orderId, message: err instanceof Error ? err.message : "خطأ غير متوقع" });
    }
  }

  return NextResponse.json({ data: { updatedCount, errors } });
}
