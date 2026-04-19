import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const teams = await prisma.team.findMany({
    include: {
      manager: { select: { id: true, name: true, email: true } },
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });

  const data = teams.map(({ _count, ...team }) => ({
    ...team,
    memberCount: _count.members,
  }));

  return NextResponse.json({ data }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const body = await request.json();
  const { name, managerId } = body;

  if (!name || !managerId) {
    return NextResponse.json(
      { error: "الاسم ومعرّف المدير مطلوبان" },
      { status: 400 }
    );
  }

  const manager = await prisma.user.findUnique({ where: { id: managerId } });
  if (!manager) {
    return NextResponse.json({ error: "المدير غير موجود" }, { status: 404 });
  }

  const existing = await prisma.team.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: "اسم الفريق مستخدم بالفعل" },
      { status: 409 }
    );
  }

  const team = await prisma.team.create({
    data: { name, managerId },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      _count: { select: { members: true } },
    },
  });

  const { _count, ...rest } = team;
  return NextResponse.json(
    { data: { ...rest, memberCount: _count.members } },
    { status: 201 }
  );
}
