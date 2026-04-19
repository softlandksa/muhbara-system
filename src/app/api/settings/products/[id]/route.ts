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
  const { name, sku, defaultPrice, isActive } = body;

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
  });
  if (!product) {
    return NextResponse.json({ error: "المنتج غير موجود" }, { status: 404 });
  }

  if (sku) {
    const duplicate = await prisma.product.findFirst({
      where: { sku, id: { not: id }, deletedAt: null },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "رمز المنتج (SKU) مستخدم بالفعل" },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(sku !== undefined && { sku }),
      ...(defaultPrice !== undefined && { defaultPrice: Number(defaultPrice) }),
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

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
  });
  if (!product) {
    return NextResponse.json({ error: "المنتج غير موجود" }, { status: 404 });
  }

  const updated = await prisma.product.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
