import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const { name, isActive } = body;

  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: { id, deletedAt: null },
  });
  if (!paymentMethod) {
    return NextResponse.json(
      { error: "طريقة الدفع غير موجودة" },
      { status: 404 }
    );
  }

  if (name) {
    const duplicate = await prisma.paymentMethod.findFirst({
      where: { name, id: { not: id }, deletedAt: null },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "الاسم مستخدم بالفعل" },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.paymentMethod.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(isActive !== undefined && { isActive }),
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

  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: { id, deletedAt: null },
  });
  if (!paymentMethod) {
    return NextResponse.json(
      { error: "طريقة الدفع غير موجودة" },
      { status: 404 }
    );
  }

  const updated = await prisma.paymentMethod.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
