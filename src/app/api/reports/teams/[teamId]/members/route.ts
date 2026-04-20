import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "date-fns";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId: sessionTeamId } = session.user;

  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { teamId } = await params;

  // SALES_MANAGER can only query their own team
  if (role === "SALES_MANAGER") {
    let effectiveTeamId = sessionTeamId;
    if (!effectiveTeamId) {
      const managed = await prisma.team.findFirst({
        where: { managerId: userId },
        select: { id: true },
      });
      effectiveTeamId = managed?.id ?? null;
    }
    if (!effectiveTeamId || teamId !== effectiveTeamId) {
      return NextResponse.json({ error: "ممنوع" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const dateFrom   = searchParams.get("dateFrom");
  const dateTo     = searchParams.get("dateTo");
  const statusIds  = searchParams.getAll("status");
  const countryIds = searchParams.getAll("countryId");
  const currencyId = searchParams.get("currencyId");

  // Parallel lookups: members, statuses, currencies
  const [members, allStatuses, allCurrencies] = await Promise.all([
    prisma.user.findMany({
      where: { teamId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.shippingStatusPrimary.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.currency.findMany({ select: { id: true, code: true } }),
  ]);

  if (members.length === 0) {
    return NextResponse.json({
      data: {
        members: [],
        salesByCurrency: [],
        statusMatrix: { statuses: allStatuses, rows: [] },
      },
    });
  }

  const memberIds  = members.map((m) => m.id);
  const currencyMap = new Map(allCurrencies.map((c) => [c.id, c.code]));

  const baseFilter: Record<string, unknown> = {
    deletedAt: null,
    teamId,
    createdById: { in: memberIds },
  };
  if (dateFrom || dateTo) {
    const dw: Record<string, unknown> = {};
    if (dateFrom) dw.gte = new Date(dateFrom);
    if (dateTo)   dw.lte = endOfDay(new Date(dateTo));
    baseFilter.orderDate = dw;
  }
  if (statusIds.length  > 0) baseFilter.statusId  = { in: statusIds };
  if (countryIds.length > 0) baseFilter.countryId = { in: countryIds };
  if (currencyId)            baseFilter.currencyId = currencyId;

  // Two batch queries — one for Panel A (sales), one for Panel B (status counts)
  const [salesRows, statusRows] = await Promise.all([
    prisma.order.groupBy({
      by: ["createdById", "currencyId"],
      where: baseFilter,
      _sum:   { totalAmount: true },
      _count: { id: true },
    }),
    prisma.order.groupBy({
      by: ["createdById", "statusId"],
      where: baseFilter,
      _count: { id: true },
    }),
  ]);

  // Panel A: group by currency → ranked members desc by total
  const currencySalesMap = new Map<string, { userId: string; total: number; orderCount: number }[]>();
  for (const row of salesRows) {
    const code = currencyMap.get(row.currencyId) ?? "?";
    if (!currencySalesMap.has(code)) currencySalesMap.set(code, []);
    currencySalesMap.get(code)!.push({
      userId:     row.createdById,
      total:      Math.round((row._sum.totalAmount ?? 0) * 100) / 100,
      orderCount: row._count.id,
    });
  }
  const salesByCurrency = [...currencySalesMap.entries()]
    .map(([currencyCode, mems]) => ({
      currencyCode,
      members: mems
        .sort((a, b) => b.total - a.total)
        .map((m, i) => ({ ...m, rank: i + 1 })),
    }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));

  // Panel B: member × status matrix
  const memberStatusMap = new Map<string, Map<string, number>>();
  const memberTotalMap  = new Map<string, number>();
  for (const row of statusRows) {
    if (!memberStatusMap.has(row.createdById)) memberStatusMap.set(row.createdById, new Map());
    memberStatusMap.get(row.createdById)!.set(row.statusId, row._count.id);
    memberTotalMap.set(row.createdById, (memberTotalMap.get(row.createdById) ?? 0) + row._count.id);
  }

  const rows = members
    .map((m) => {
      const counts: Record<string, number> = {};
      const statusMap = memberStatusMap.get(m.id);
      if (statusMap) for (const [sid, cnt] of statusMap) counts[sid] = cnt;
      return { userId: m.id, total: memberTotalMap.get(m.id) ?? 0, counts };
    })
    .sort((a, b) => b.total - a.total);

  // Only include statuses that appear in these results
  const usedStatusIds = new Set(statusRows.map((r) => r.statusId));
  const relevantStatuses = allStatuses.filter((s) => usedStatusIds.has(s.id));

  return NextResponse.json({
    data: {
      members,
      salesByCurrency,
      statusMatrix: { statuses: relevantStatuses, rows },
    },
  });
}
