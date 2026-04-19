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

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: products }, { status: 200 });
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
  const { name, sku, defaultPrice } = body;

  if (!name) {
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
  }
  if (defaultPrice === undefined || defaultPrice === null) {
    return NextResponse.json({ error: "السعر الافتراضي مطلوب" }, { status: 400 });
  }

  if (sku) {
    const existing = await prisma.product.findFirst({
      where: { sku, deletedAt: null },
    });
    if (existing) {
      return NextResponse.json(
        { error: "رمز المنتج (SKU) مستخدم بالفعل" },
        { status: 409 }
      );
    }
  }

  const product = await prisma.product.create({
    data: { name, sku, defaultPrice: Number(defaultPrice) },
  });

  return NextResponse.json({ data: product }, { status: 201 });
}
