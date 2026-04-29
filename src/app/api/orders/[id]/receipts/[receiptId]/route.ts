import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewOrder } from "@/lib/permissions";
import { fetchReceiptBuffer } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; receiptId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { id, receiptId } = await ctx.params;

  const order = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      createdById: true,
      teamId: true,
      receipts: {
        where: { id: receiptId },
        select: { id: true, url: true, mimeType: true },
      },
    },
  });

  if (!order) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });

  const { role, id: userId, teamId } = session.user;
  if (!canViewOrder(role, userId, teamId, order.createdById, order.teamId)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const receipt = order.receipts[0];
  if (!receipt) return NextResponse.json({ error: "الإيصال غير موجود" }, { status: 404 });

  try {
    const { buffer, mime } = await fetchReceiptBuffer(receipt.url);
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime] ?? "bin";
    const filename = `receipt-${order.orderNumber}-${receipt.id.slice(-6)}.${ext}`;

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
