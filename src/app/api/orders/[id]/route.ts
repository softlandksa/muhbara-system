import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditOrder, canViewOrder } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { deleteFile } from "@/lib/storage";

const fullOrderInclude = {
  status: { select: { id: true, name: true, color: true, sortOrder: true } },
  country: true,
  currency: true,
  paymentMethod: true,
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  team: true,
  items: { include: { product: true } },
  shippingInfo: {
    include: {
      shippingCompany: true,
      shippedBy: { select: { id: true, name: true } },
      shippingSubStatus: {
        include: { primary: { select: { id: true, name: true, color: true } } },
      },
    },
  },
  followUpNotes: {
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  auditLogs: {
    include: { changedBy: { select: { id: true, name: true } } },
    orderBy: { changedAt: "asc" as const },
  },
};

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    include: fullOrderInclude,
  });
  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  const { role, id: userId, teamId } = session.user;
  if (!canViewOrder(role, userId, teamId, order.createdById, order.teamId)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  return NextResponse.json({ data: order });
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({ where: { id, deletedAt: null } });
  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  const { role, id: userId, teamId } = session.user;
  if (!canEditOrder(role, userId, order.createdById)) {
    return NextResponse.json({ error: "لا يمكن تعديل هذا الطلب" }, { status: 403 });
  }

  const body = await request.json();
  const {
    customerName, phone, address, countryId, currencyId,
    paymentMethodId, notes, statusId,
  } = body;

  const auditEntries: Array<{
    orderId: string; action: string; fieldName?: string;
    oldValue?: string; newValue?: string; changedById: string; changedAt: Date;
  }> = [];

  const updateData: Record<string, unknown> = {};
  if (customerName !== undefined && customerName !== order.customerName) {
    auditEntries.push({ orderId: id, action: "UPDATE", fieldName: "customerName", oldValue: order.customerName, newValue: customerName, changedById: userId, changedAt: new Date() });
    updateData.customerName = customerName;
  }
  if (phone !== undefined && phone !== order.phone) {
    auditEntries.push({ orderId: id, action: "UPDATE", fieldName: "phone", oldValue: order.phone, newValue: phone, changedById: userId, changedAt: new Date() });
    updateData.phone = phone;
  }
  if (address !== undefined && address !== order.address) {
    auditEntries.push({ orderId: id, action: "UPDATE", fieldName: "address", oldValue: order.address, newValue: address, changedById: userId, changedAt: new Date() });
    updateData.address = address;
  }
  if (countryId !== undefined) updateData.countryId = countryId;
  if (currencyId !== undefined) updateData.currencyId = currencyId;
  if (paymentMethodId !== undefined) updateData.paymentMethodId = paymentMethodId;
  if (notes !== undefined) updateData.notes = notes;
  if (statusId !== undefined && statusId !== order.statusId) {
    auditEntries.push({ orderId: id, action: "STATUS_CHANGE", fieldName: "status", oldValue: order.statusId, newValue: statusId, changedById: userId, changedAt: new Date() });
    updateData.statusId = statusId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.order.update({ where: { id }, data: updateData });
    if (auditEntries.length > 0) {
      await tx.orderAuditLog.createMany({ data: auditEntries });
    }
    await logActivity(tx, { userId, action: "UPDATE_ORDER", entityType: "Order", entityId: id });
    return result;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, paymentReceiptUrl: true },
  });
  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  await prisma.order.update({ where: { id }, data: { deletedAt: new Date() } });

  // Fire-and-forget: clean up blob receipt so storage doesn't accumulate orphans.
  if (order.paymentReceiptUrl && !order.paymentReceiptUrl.startsWith("local://")) {
    deleteFile(order.paymentReceiptUrl).catch((e) =>
      console.error("[DELETE /api/orders/:id] blob cleanup failed:", e)
    );
  }

  return NextResponse.json({ data: { success: true } });
}
