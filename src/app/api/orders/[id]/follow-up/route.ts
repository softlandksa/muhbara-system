import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({ where: { id, deletedAt: null } });
  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  const data = await prisma.followUpNote.findMany({
    where: { orderId: id },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ data });
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;
  if (role !== "ADMIN" && role !== "FOLLOWUP") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id: orderId } = await ctx.params;
  const order = await prisma.order.findFirst({ where: { id: orderId, deletedAt: null } });
  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  const body = await request.json();
  const { note } = body;
  if (!note?.trim()) return NextResponse.json({ error: "الملاحظة مطلوبة" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.followUpNote.create({
      data: { orderId, note: note.trim(), createdById: userId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await tx.orderAuditLog.create({
      data: {
        orderId,
        action: "NOTE_ADDED",
        newValue: note.trim(),
        changedById: userId,
        changedAt: new Date(),
      },
    });
    return created;
  });

  return NextResponse.json({ data: result }, { status: 201 });
}
