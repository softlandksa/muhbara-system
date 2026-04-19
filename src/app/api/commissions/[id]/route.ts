import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import type { CommissionStatus } from "@/types";

const VALID_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  PENDING: ["APPROVED"],
  APPROVED: ["PAID"],
  PAID: [],
};

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { id } = await ctx.params;
  const { id: adminId } = session.user;
  const body = await request.json();
  const { status } = body as { status: CommissionStatus };

  const commission = await prisma.commission.findUnique({ where: { id } });
  if (!commission) return NextResponse.json({ error: "العمولة غير موجودة" }, { status: 404 });

  const allowed = VALID_TRANSITIONS[commission.status];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "لا يمكن تغيير الحالة" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.commission.update({
      where: { id },
      data: {
        status,
        ...(status === "APPROVED" && { approvedById: adminId }),
      },
      include: {
        user: { select: { id: true, name: true } },
        currency: { select: { code: true, symbol: true } },
      },
    });

    await logActivity(tx, {
      userId: adminId,
      action: "UPDATE_COMMISSION_STATUS",
      entityType: "Commission",
      entityId: id,
      details: { oldStatus: commission.status, newStatus: status },
    });

    return result;
  });

  return NextResponse.json({ data: updated });
}
