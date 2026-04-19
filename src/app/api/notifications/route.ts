import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { id: userId } = session.user;

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const countOnly = searchParams.get("countOnly") === "true";
  const filter = searchParams.get("filter") ?? "all"; // all | unread | read

  const where: Record<string, unknown> = { userId };
  if (unreadOnly || filter === "unread") where.isRead = false;
  if (filter === "read") where.isRead = true;

  if (countOnly) {
    const count = await prisma.notification.count({ where: { userId, isRead: false } });
    return NextResponse.json({ count });
  }

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: notifications });
}

export async function PUT(request: NextRequest) {
  // Mark all as read
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { id: userId } = session.user;

  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  return NextResponse.json({ data: { ok: true } });
}
