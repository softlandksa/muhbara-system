import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

const trackingSchema = z.object({
  trackingNumber: z.string().max(100).trim().nullable(),
});

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;
  if (role !== "ADMIN" && role !== "SHIPPING") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { orderId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const parsed = trackingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 }
    );
  }

  const normalizedTracking = parsed.data.trackingNumber?.trim() || null;

  const shippingInfo = await prisma.shippingInfo.findUnique({
    where: { orderId },
    select: {
      id: true,
      trackingNumber: true,
      order: { select: { orderNumber: true } },
    },
  });
  if (!shippingInfo) {
    return NextResponse.json(
      { error: "لا توجد معلومات شحن لهذا الطلب" },
      { status: 404 }
    );
  }

  const oldTracking = shippingInfo.trackingNumber;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.shippingInfo.update({
      where: { id: shippingInfo.id },
      data: { trackingNumber: normalizedTracking },
      select: { trackingNumber: true },
    });

    await tx.orderAuditLog.create({
      data: {
        orderId,
        action: "FIELD_CHANGE",
        fieldName: "trackingNumber",
        oldValue: oldTracking ?? "",
        newValue: normalizedTracking ?? "",
        changedById: userId,
        changedAt: new Date(),
      },
    });

    await logActivity(tx, {
      userId,
      action: "UPDATE_TRACKING",
      entityType: "Order",
      entityId: orderId,
      details: { old: oldTracking, new: normalizedTracking },
    });

    return result;
  });

  return NextResponse.json({ data: { trackingNumber: updated.trackingNumber } });
}
