import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { id: userId } = session.user;

  const { id } = await ctx.params;

  const notification = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!notification) return NextResponse.json({ error: "غير موجود" }, { status: 404 });

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });

  return NextResponse.json({ data: updated });
}
