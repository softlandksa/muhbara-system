import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNotificationsForRole } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";

const orderSelect = {
  status: { select: { id: true, name: true, color: true, sortOrder: true } },
  country: { select: { id: true, name: true } },
  currency: { select: { id: true, symbol: true, code: true } },
  createdBy: { select: { id: true, name: true } },
  // Hard limit: show up to 5 items per order; the table cell is truncated anyway.
  items: {
    take: 5,
    include: { product: { select: { id: true, name: true } } },
  },
  _count: { select: { items: true } },
};

const shippingInfoInclude = {
  shippingCompany: { select: { id: true, name: true, trackingUrl: true } },
  shippedBy: { select: { id: true, name: true } },
  shippingSubStatus: {
    select: {
      id: true, name: true, colorOverride: true, marksOrderDelivered: true,
      primary: { select: { id: true, name: true, color: true } },
    },
  },
};

const shipSchema = z.object({
  orderId:          z.string().min(1),
  shippingCompanyId: z.string().min(1, "شركة الشحن مطلوبة"),
  trackingNumber:   z.string().optional(),
  subStatusId:      z.string().min(1, "حالة الشحن مطلوبة"),
  notes:            z.string().optional(),
});

// Hard cap to prevent unbounded full-table scans on the shipping board.
// The board relies on client-side tab filtering, so all active orders must be
// loaded at once; 500 is a safe upper bound for a typical shipping operation.
const SHIPPING_BOARD_LIMIT = 500;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role } = session.user;
  if (role !== "ADMIN" && role !== "SHIPPING") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusId   = searchParams.get("statusId");
  const dateFrom   = searchParams.get("dateFrom");    // "yyyy-MM-dd" inclusive start (UTC 00:00Z)
  const dateTo     = searchParams.get("dateTo");      // "yyyy-MM-dd" inclusive end   (UTC 23:59:59.999Z)
  // Multi-country inclusion filter — countryIds: comma-separated cuid list, max 30.
  // NULL policy: countryId is non-nullable on Order, so no NULL edge-case applies.
  const countryIdsRaw = searchParams.get("countryIds") ?? "";
  const countryIds = countryIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30); // hard cap — prevent oversized IN clauses

  const where: Record<string, unknown> = { deletedAt: null };
  if (statusId) where.statusId = statusId;

  if (countryIds.length > 0) {
    where.countryId = { in: countryIds };
  }

  // Date filter on orderDate (business date — same column the board shows as «التاريخ»).
  // Bounds use explicit UTC suffix so behaviour is timezone-independent on the server.
  if (dateFrom || dateTo) {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo)   dateFilter.lte = new Date(dateTo + "T23:59:59.999Z");
    where.orderDate = dateFilter;
  }

  const data = await prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      customerName: true,
      phone: true,
      totalAmount: true,
      ...orderSelect,
      shippingInfo: { include: shippingInfoInclude },
    },
    orderBy: { createdAt: "desc" },
    take: SHIPPING_BOARD_LIMIT,
  });

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;
  if (role !== "ADMIN" && role !== "SHIPPING") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = shipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 }
    );
  }

  const { orderId, shippingCompanyId, trackingNumber, subStatusId, notes } = parsed.data;

  // Fetch order + sub-status in parallel; both are independent lookups.
  const [order, sub] = await Promise.all([
    prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { status: { select: { name: true } } },
    }),
    prisma.shippingStatusSub.findUnique({
      where: { id: subStatusId },
      include: { primary: true },
    }),
  ]);

  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
  if (!sub)   return NextResponse.json({ error: "حالة الشحن غير موجودة" }, { status: 400 });

  const isDelivered = sub.marksOrderDelivered;

  // Check for existing shipping record (must be inside the guard before transaction).
  const existingShipping = await prisma.shippingInfo.findUnique({ where: { orderId } });
  if (existingShipping) {
    return NextResponse.json({ error: "هذا الطلب تم شحنه مسبقاً" }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const shippingInfo = await tx.shippingInfo.create({
        data: {
          order:             { connect: { id: orderId } },
          shippingCompany:   { connect: { id: shippingCompanyId } },
          shippedBy:         { connect: { id: userId } },
          shippingSubStatus: { connect: { id: subStatusId } },
          trackingNumber:    trackingNumber?.trim() || null,
          shippedAt:         new Date(),
          notes:             notes?.trim() || null,
          ...(isDelivered && { deliveredAt: new Date() }),
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { statusId: sub.primaryId },
      });

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

      await createNotificationsForRole(tx, {
        role:           "FOLLOWUP",
        title:          "تحديث حالة طلب",
        message:        `طلب ${order.orderNumber}: ${order.status.name} → ${sub.name}`,
        type:           "ORDER_STATUS",
        relatedOrderId: orderId,
      });

      await logActivity(tx, {
        userId,
        action:     "SHIP_ORDER",
        entityType: "Order",
        entityId:   orderId,
        details:    { trackingNumber, shippingCompanyId, subStatus: sub.name, primary: sub.primary.name },
      });

      return shippingInfo;
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/shipping] error:", err);
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
