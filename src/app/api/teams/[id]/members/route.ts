import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
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

  const { id: teamId } = await ctx.params;
  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json(
      { error: "معرّف المستخدم مطلوب" },
      { status: 400 }
    );
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    return NextResponse.json({ error: "الفريق غير موجود" }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json(
      { error: "المستخدم غير موجود" },
      { status: 404 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { teamId },
    select: { id: true, name: true, email: true, role: true, teamId: true },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}

export async function DELETE(
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

  const { id: teamId } = await ctx.params;
  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json(
      { error: "معرّف المستخدم مطلوب" },
      { status: 400 }
    );
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    return NextResponse.json({ error: "الفريق غير موجود" }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json(
      { error: "المستخدم غير موجود" },
      { status: 404 }
    );
  }

  if (user.teamId !== teamId) {
    return NextResponse.json(
      { error: "المستخدم ليس عضواً في هذا الفريق" },
      { status: 400 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { teamId: null },
    select: { id: true, name: true, email: true, role: true, teamId: true },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
