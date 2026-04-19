import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function prismaErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    switch ((e as { code: string }).code) {
      case "P2025": return "الشريحة غير موجودة";
      case "P2003": return "خطأ في العلاقات — تحقق من البيانات";
      default: break;
    }
  }
  return "خطأ في قاعدة البيانات";
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;

  try {
    await prisma.commissionRule.delete({ where: { id } });
    return NextResponse.json({ data: { id } });
  } catch (e) {
    console.error("[commissions/rules DELETE]", e);
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "الشريحة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({ error: prismaErrorMessage(e) }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صالحة" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 });
  }

  try {
    const rule = await prisma.commissionRule.update({
      where: { id },
      data: updateData,
      include: { currency: { select: { id: true, code: true, symbol: true } } },
    });
    return NextResponse.json({ data: rule });
  } catch (e) {
    console.error("[commissions/rules PUT]", e);
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "الشريحة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({ error: prismaErrorMessage(e) }, { status: 500 });
  }
}
