import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId } = session.user;
  const isAdmin = role === "ADMIN";
  const isGeneralManager = role === "GENERAL_MANAGER";
  const isManager = role === "SALES_MANAGER";

  const isHR = role === "HR";
  if (!isAdmin && !isGeneralManager && !isManager && !isHR && role !== "SALES") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filterUserId = searchParams.get("userId");
  const status = searchParams.get("status");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const where: Record<string, unknown> = {};
  if (!isAdmin && !isGeneralManager && !isManager && !isHR) where.userId = userId;
  if ((isAdmin || isGeneralManager || isHR) && filterUserId) where.userId = filterUserId;
  if (isManager) where.user = { teamId: (await prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } }))?.teamId };
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    const dw: Record<string, unknown> = {};
    if (dateFrom) dw.gte = new Date(dateFrom);
    if (dateTo) dw.lte = endOfDay(new Date(dateTo));
    where.periodStart = dw;
  }

  const commissions = await prisma.commission.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, role: true } },
      rule: { select: { id: true, name: true, commissionType: true } },
      currency: { select: { id: true, code: true, symbol: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: { calculatedAt: "desc" },
  });

  const total = commissions.reduce((s, c) => s + c.commissionAmount, 0);

  return NextResponse.json({ data: commissions, totalAmount: Math.round(total * 100) / 100 });
}
