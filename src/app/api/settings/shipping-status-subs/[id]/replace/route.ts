import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

const replaceSchema = z.object({
  replacementSubId: z.string().min(1, "الحالة البديلة مطلوبة"),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id: sourceId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 }); }

  const parsed = replaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" }, { status: 400 });
  }
  const { replacementSubId } = parsed.data;

  if (sourceId === replacementSubId) {
    return NextResponse.json({ error: "لا يمكن اختيار الحالة نفسها كبديل" }, { status: 400 });
  }

  // Validate source and replacement exist and belong to same primary
  const [source, replacement] = await Promise.all([
    prisma.shippingStatusSub.findFirst({ where: { id: sourceId, deletedAt: null } }),
    prisma.shippingStatusSub.findFirst({ where: { id: replacementSubId, isActive: true, deletedAt: null } }),
  ]);

  if (!source) return NextResponse.json({ error: "الحالة المصدر غير موجودة" }, { status: 404 });
  if (!replacement) return NextResponse.json({ error: "الحالة البديلة غير موجودة أو معطّلة" }, { status: 404 });
  if (source.primaryId !== replacement.primaryId) {
    return NextResponse.json({ error: "يجب أن تنتمي الحالة البديلة إلى نفس الحالة الرئيسية" }, { status: 400 });
  }

  const now = new Date();

  const { affected } = await prisma.$transaction(async (tx) => {
    // Move all ShippingInfo rows from source → replacement
    const { count } = await tx.shippingInfo.updateMany({
      where: { shippingSubStatusId: sourceId },
      data: { shippingSubStatusId: replacementSubId },
    });

    // Soft-delete the source sub
    await tx.shippingStatusSub.update({
      where: { id: sourceId },
      data: { isActive: false, deletedAt: now },
    });

    // Log the migration
    await logActivity(tx, {
      userId: session.user.id,
      action: "REPLACE_SHIPPING_SUB",
      entityType: "ShippingStatusSub",
      entityId: sourceId,
      details: {
        sourceId,
        sourceName: source.name,
        replacementId: replacementSubId,
        replacementName: replacement.name,
        affectedShipments: count,
      },
    });

    return { affected: count };
  });

  return NextResponse.json({ data: { affected } });
}
