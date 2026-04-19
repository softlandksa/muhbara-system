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

  const currencies = await prisma.currency.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: currencies }, { status: 200 });
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
  const { name, code, symbol } = body;

  if (!name || !code || !symbol) {
    return NextResponse.json(
      { error: "الاسم والرمز والعلامة مطلوبة" },
      { status: 400 }
    );
  }

  const existing = await prisma.currency.findFirst({
    where: { OR: [{ name }, { code }], deletedAt: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: "الاسم أو الرمز مستخدم بالفعل" },
      { status: 409 }
    );
  }

  const currency = await prisma.currency.create({
    data: { name, code, symbol },
  });

  return NextResponse.json({ data: currency }, { status: 201 });
}
