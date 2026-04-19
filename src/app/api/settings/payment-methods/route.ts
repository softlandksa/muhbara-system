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

  const paymentMethods = await prisma.paymentMethod.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: paymentMethods }, { status: 200 });
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
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
  }

  const existing = await prisma.paymentMethod.findFirst({
    where: { name, deletedAt: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: "طريقة الدفع موجودة بالفعل" },
      { status: 409 }
    );
  }

  const paymentMethod = await prisma.paymentMethod.create({
    data: { name },
  });

  return NextResponse.json({ data: paymentMethod }, { status: 201 });
}
