import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

function handlePrismaError(e: unknown, context: string) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: "الاسم مستخدم بالفعل في هذه الحالة الرئيسية" }, { status: 409 });
  }
  console.error(`[${context}]`, e);
  return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
}

/** GET all subs for a primary */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;
  const subs = await prisma.shippingStatusSub.findMany({
    where: { primaryId: id, deletedAt: null },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ data: subs });
}

/** POST — create a new sub under this primary */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await request.json();
  const { name, colorOverride, sortOrder, marksOrderDelivered } = body;

  if (!name) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  const primary = await prisma.shippingStatusPrimary.findFirst({ where: { id, deletedAt: null } });
  if (!primary) return NextResponse.json({ error: "الحالة الرئيسية غير موجودة" }, { status: 404 });

  try {
    const sub = await prisma.shippingStatusSub.create({
      data: {
        primaryId:           id,
        name,
        colorOverride:       colorOverride ?? null,
        sortOrder:           sortOrder ?? 0,
        marksOrderDelivered: marksOrderDelivered ?? false,
      },
    });
    return NextResponse.json({ data: sub }, { status: 201 });
  } catch (e) {
    return handlePrismaError(e, `shipping-statuses/${id}/subs POST`);
  }
}
