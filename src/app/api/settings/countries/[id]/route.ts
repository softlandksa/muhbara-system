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
  const { name, code, phoneCode, phoneFormat, isActive } = body;

  const country = await prisma.country.findFirst({
    where: { id, deletedAt: null },
  });
  if (!country) {
    return NextResponse.json({ error: "الدولة غير موجودة" }, { status: 404 });
  }

  if (code && !/^[A-Z]{2}$/.test(code)) {
    return NextResponse.json(
      { error: "يجب أن يكون الرمز حرفين كبيرين باللغة الإنجليزية" },
      { status: 400 }
    );
  }

  if (name || code) {
    const duplicate = await prisma.country.findFirst({
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

  const updated = await prisma.country.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
      ...(phoneCode !== undefined && { phoneCode }),
      ...(phoneFormat !== undefined && { phoneFormat }),
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

  const country = await prisma.country.findFirst({
    where: { id, deletedAt: null },
  });
  if (!country) {
    return NextResponse.json({ error: "الدولة غير موجودة" }, { status: 404 });
  }

  const updated = await prisma.country.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
