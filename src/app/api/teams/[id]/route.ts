import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      members: {
        select: { id: true, name: true, email: true, role: true, isActive: true },
      },
    },
  });

  if (!team) {
    return NextResponse.json({ error: "الفريق غير موجود" }, { status: 404 });
  }

  return NextResponse.json({ data: team }, { status: 200 });
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json();
  const { name, managerId } = body;

  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) {
    return NextResponse.json({ error: "الفريق غير موجود" }, { status: 404 });
  }

  if (name && name !== team.name) {
    const duplicate = await prisma.team.findUnique({ where: { name } });
    if (duplicate) {
      return NextResponse.json(
        { error: "اسم الفريق مستخدم بالفعل" },
        { status: 409 }
      );
    }
  }

  if (managerId) {
    const manager = await prisma.user.findUnique({ where: { id: managerId } });
    if (!manager) {
      return NextResponse.json(
        { error: "المدير غير موجود" },
        { status: 404 }
      );
    }
  }

  const updated = await prisma.team.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(managerId !== undefined && { managerId }),
    },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      members: {
        select: { id: true, name: true, email: true, role: true, isActive: true },
      },
    },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) {
    return NextResponse.json({ error: "الفريق غير موجود" }, { status: 404 });
  }

  const ordersCount = await prisma.order.count({
    where: { teamId: id, deletedAt: null },
  });
  if (ordersCount > 0) {
    return NextResponse.json(
      { error: "لا يمكن حذف الفريق لأنه مرتبط بطلبات موجودة" },
      { status: 409 }
    );
  }

  await prisma.team.delete({ where: { id } });

  return NextResponse.json(
    { data: { message: "تم حذف الفريق بنجاح" } },
    { status: 200 }
  );
}
