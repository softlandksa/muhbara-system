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
  const { name, code, symbol, isActive } = body;

  const currency = await prisma.currency.findFirst({
    where: { id, deletedAt: null },
  });
  if (!currency) {
    return NextResponse.json({ error: "العملة غير موجودة" }, { status: 404 });
  }

  if (name || code) {
    const duplicate = await prisma.currency.findFirst({
      where: {
        AND: [
          { id: { not: id } },
          { deletedAt: null },
          { OR: [...(name ? [{ name }] : []), ...(code ? [{ code }] : [])] },
        ],
      },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "الاسم أو الرمز مستخدم بالفعل" },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.currency.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
      ...(symbol !== undefined && { symbol }),
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

  const currency = await prisma.currency.findFirst({
    where: { id, deletedAt: null },
  });
  if (!currency) {
    return NextResponse.json({ error: "العملة غير موجودة" }, { status: 404 });
  }

  const updated = await prisma.currency.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
