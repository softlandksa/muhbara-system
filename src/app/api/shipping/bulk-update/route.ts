import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bulkUpdateSchema = z.object({
  orderIds:          z.array(z.string().min(1)).min(1, "يجب تحديد طلب واحد على الأقل"),
  subStatusId:       z.string().min(1, "الحالة مطلوبة"),
  shippingCompanyId: z.string().min(1).optional(),
  trackingNumber:    z.string().optional(),
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
      { status: 400 },
    );
  }

  const { orderIds, subStatusId, shippingCompanyId, trackingNumber } = parsed.data;

  // Fetch sub-status and (optionally) shipping company in parallel
  const [sub, shippingCompany] = await Promise.all([
    prisma.shippingStatusSub.findUnique({
      where: { id: subStatusId },
      include: { primary: true },
    }),
    shippingCompanyId
      ? prisma.shippingCompany.findUnique({ where: { id: shippingCompanyId } })
      : Promise.resolve(null),
  ]);

  if (!sub) return NextResponse.json({ error: "الحالة غير موجودة" }, { status: 404 });
  if (shippingCompanyId && !shippingCompany) {
    return NextResponse.json({ error: "شركة الشحن غير موجودة" }, { status: 404 });
  }

  const isDelivered = sub.marksOrderDelivered;
  const now = new Date();

  // ── Single query: fetch all target orders + their shipping records ────────────
  // Replaces the old N×findFirst inside the per-order loop (N+1 eliminated).
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, deletedAt: null },
    select: {
      id: true,
      status: { select: { name: true } },
      shippingInfo: { select: { id: true } },
    },
  });

  const foundIds = new Set(orders.map((o) => o.id));
  const errors: { orderId: string; message: string }[] = orderIds
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ orderId: id, message: `الطلب ${id} غير موجود` }));

  if (orders.length === 0) {
    return NextResponse.json({ data: { updatedCount: 0, errors } });
  }

  const ordersWithShipping    = orders.filter((o) => o.shippingInfo !== null);
  const ordersWithoutShipping = orders.filter((o) => o.shippingInfo === null);
  const trackingTrimmed       = trackingNumber?.trim() || undefined;

  // ── Batch mutations in one transaction ────────────────────────────────────────
  // Before: N transactions × 5 queries each = 5N round-trips.
  // After:  1 transaction × 4 batch statements = 4 round-trips regardless of N.
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Update all order statuses at once
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data:  { statusId: sub.primaryId },
      });

      // 2. Update existing shipping records at once
      if (ordersWithShipping.length > 0) {
        await tx.shippingInfo.updateMany({
          where: { id: { in: ordersWithShipping.map((o) => o.shippingInfo!.id) } },
          data: {
            shippingSubStatusId: subStatusId,
            ...(isDelivered      && { deliveredAt: now }),
            ...(shippingCompanyId && { shippingCompanyId }),
            ...(trackingTrimmed  && { trackingNumber: trackingTrimmed }),
          },
        });
      }

      // 3. Create shipping records for orders that don't have one yet
      if (shippingCompanyId && ordersWithoutShipping.length > 0) {
        await tx.shippingInfo.createMany({
          data: ordersWithoutShipping.map((o) => ({
            orderId:            o.id,
            shippingCompanyId:  shippingCompanyId!,
            shippingSubStatusId: subStatusId,
            shippedAt:          now,
            shippedById:        userId,
            ...(isDelivered     && { deliveredAt: now }),
            ...(trackingTrimmed && { trackingNumber: trackingTrimmed }),
          })),
          skipDuplicates: true, // guard against concurrent updates on the same order
        });
      }

      // 4. Batch audit logs
      await tx.orderAuditLog.createMany({
        data: orders.map((o) => ({
          orderId:     o.id,
          action:      "STATUS_CHANGE",
          fieldName:   "status",
          oldValue:    o.status.name,
          newValue:    sub.name,
          changedById: userId,
          changedAt:   now,
        })),
      });
    });
  } catch (err) {
    console.error("[bulk-update] transaction error:", err);
    const message = err instanceof Error ? err.message : "خطأ غير متوقع";
    for (const o of orders) {
      errors.push({ orderId: o.id, message });
    }
    return NextResponse.json({ data: { updatedCount: 0, errors } });
  }

  // ── Activity log — fire-and-forget, not on the critical path ─────────────────
  prisma.activityLog.createMany({
    data: orders.map((o) => ({
      userId,
      action:     "UPDATE_ORDER_STATUS",
      entityType: "Order",
      entityId:   o.id,
      details:    {
        subStatus: sub.name,
        primary:   sub.primary.name,
        bulk:      true,
        ...(shippingCompanyId && { shippingCompanyId, shippingCompanyName: shippingCompany?.name }),
      },
    })),
  }).catch((err) => console.error("[bulk-update] activity log error:", err));

  return NextResponse.json({ data: { updatedCount: orders.length, errors } });
}
