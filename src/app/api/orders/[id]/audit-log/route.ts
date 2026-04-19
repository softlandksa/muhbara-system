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

  const data = await prisma.orderAuditLog.findMany({
    where: { orderId: id },
    include: { changedBy: { select: { id: true, name: true } } },
    orderBy: { changedAt: "asc" },
  });
  return NextResponse.json({ data });
}
