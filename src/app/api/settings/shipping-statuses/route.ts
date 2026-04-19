import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const primarySchema = z.object({
  name:      z.string().min(1, "الاسم مطلوب").max(80),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/, "لون غير صالح").optional(),
  sortOrder: z.number().int().min(0).optional(),
});

function handlePrismaError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: "الاسم مستخدم بالفعل" }, { status: 409 });
  }
  console.error("[shipping-statuses]", e);
  return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  try {
    const statuses = await prisma.shippingStatusPrimary.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
      include: {
        subs: {
          where: { deletedAt: null },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    return NextResponse.json({ data: statuses });
  } catch (e) {
    return handlePrismaError(e);
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 }); }

  const parsed = primarySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" }, { status: 400 });
  }
  const { name, color, sortOrder } = parsed.data;

  try {
    const status = await prisma.shippingStatusPrimary.create({
      data: { name, color: color ?? "#6b7280", sortOrder: sortOrder ?? 0 },
      include: {
        subs: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      },
    });
    return NextResponse.json({ data: status }, { status: 201 });
  } catch (e) {
    return handlePrismaError(e);
  }
}
