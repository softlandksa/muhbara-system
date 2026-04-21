import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewOrder } from "@/lib/permissions";
import { fetchReceiptBuffer } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { id } = await ctx.params;
  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      createdById: true,
      teamId: true,
      paymentReceiptUrl: true,
      paymentReceiptMime: true,
    },
  });

  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
  if (!order.paymentReceiptUrl) return NextResponse.json({ error: "لا يوجد إيصال سداد لهذا الطلب" }, { status: 404 });

  const { role, id: userId, teamId } = session.user;
  if (!canViewOrder(role, userId, teamId, order.createdById, order.teamId)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  try {
    const { buffer, mime } = await fetchReceiptBuffer(order.paymentReceiptUrl);
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime] ?? "bin";
    const filename = `receipt-${order.orderNumber}.${ext}`;

    return new Response(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشل تحميل الإيصال";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
