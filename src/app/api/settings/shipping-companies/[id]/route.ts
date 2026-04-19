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
  const { name, trackingUrl, isActive } = body;

  const company = await prisma.shippingCompany.findFirst({
    where: { id, deletedAt: null },
  });
  if (!company) {
    return NextResponse.json(
      { error: "شركة الشحن غير موجودة" },
      { status: 404 }
    );
  }

  if (name) {
    const duplicate = await prisma.shippingCompany.findFirst({
      where: { name, id: { not: id }, deletedAt: null },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "الاسم مستخدم بالفعل" },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.shippingCompany.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(trackingUrl !== undefined && { trackingUrl }),
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

  const company = await prisma.shippingCompany.findFirst({
    where: { id, deletedAt: null },
  });
  if (!company) {
    return NextResponse.json(
      { error: "شركة الشحن غير موجودة" },
      { status: 404 }
    );
  }

  const updated = await prisma.shippingCompany.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
