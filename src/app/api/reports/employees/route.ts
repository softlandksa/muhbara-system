import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, teamId: sessionTeamId } = session.user;
  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER" && role !== "HR") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom     = searchParams.get("dateFrom");
  const dateTo       = searchParams.get("dateTo");
  const statusIds    = searchParams.getAll("status");
  const countryIds   = searchParams.getAll("countryId");
  const currencyId   = searchParams.get("currencyId");
  const filterTeamId = searchParams.get("teamId");

  // Delivered: metadata-based (marksOrderDelivered on subs → primary IDs), no hardcoded names.
  // Returned/cancelled: no metadata flag exists — name lookup is the only option.
  const [deliveredSubs, namedStatuses, allCurrencies] = await Promise.all([
    prisma.shippingStatusSub.findMany({
      where: { marksOrderDelivered: true, isActive: true, deletedAt: null },
      select: { primaryId: true },
      distinct: ["primaryId"],
    }),
    prisma.shippingStatusPrimary.findMany({
      where: { name: { in: ["مرتجع", "ملغي"] }, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.currency.findMany({ select: { id: true, code: true } }),
  ]);

  const deliveredPrimaryIds = new Set(deliveredSubs.map((s) => s.primaryId));
  const statusByName        = new Map(namedStatuses.map((s) => [s.name, s.id]));
  const currencyMap         = new Map(allCurrencies.map((c) => [c.id, c.code]));
  const returnedId          = statusByName.get("مرتجع");
  const cancelledId         = statusByName.get("ملغي");

  const baseFilter: Record<string, unknown> = { deletedAt: null };
  if (dateFrom || dateTo) {
    const dw: Record<string, unknown> = {};
    if (dateFrom) dw.gte = new Date(dateFrom);
    if (dateTo)   dw.lte = endOfDay(new Date(dateTo));
    baseFilter.orderDate = dw;
  }
  if (statusIds.length  > 0) baseFilter.statusId  = { in: statusIds };
  if (countryIds.length > 0) baseFilter.countryId = { in: countryIds };
  if (currencyId) baseFilter.currencyId = currencyId;

  if (role === "SALES_MANAGER" && sessionTeamId) baseFilter.teamId = sessionTeamId;
  if ((role === "ADMIN" || role === "GENERAL_MANAGER" || role === "HR") && filterTeamId) {
    baseFilter.teamId = filterTeamId;
  }

  const userWhere: Record<string, unknown> = {
    role: { in: ["SALES", "SUPPORT", "SALES_MANAGER"] },
    isActive: true,
  };
  if (role === "SALES_MANAGER" && sessionTeamId) userWhere.teamId = sessionTeamId;
  if ((role === "ADMIN" || role === "GENERAL_MANAGER" || role === "HR") && filterTeamId) {
    userWhere.teamId = filterTeamId;
  }

  const employees = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, name: true, role: true, team: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  if (employees.length === 0) return NextResponse.json({ data: [] });

  const employeeIds  = employees.map((e) => e.id);
  const batchFilter  = { ...baseFilter, createdById: { in: employeeIds } };

  // 3 batch queries replace 6 × N per-employee round-trips
  const [countsByStatus, revenueRows, lastOrderRows] = await Promise.all([
    prisma.order.groupBy({
      by: ["createdById", "statusId"],
      where: batchFilter,
      _count: { id: true },
    }),
    prisma.order.groupBy({
      by: ["createdById", "currencyId"],
      where: batchFilter,
      _sum: { totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ["createdById"],
      where: batchFilter,
      _max: { orderDate: true },
    }),
  ]);

  // Build: Map<createdById, Map<statusId, count>>
  const countMap = new Map<string, Map<string, number>>();
  for (const row of countsByStatus) {
    if (!row.createdById) continue;
    if (!countMap.has(row.createdById)) countMap.set(row.createdById, new Map());
    countMap.get(row.createdById)!.set(row.statusId, row._count.id);
  }

  // Build: Map<createdById, {currencyId, total}[]>
  const revenueMap = new Map<string, { currencyId: string; total: number }[]>();
  for (const row of revenueRows) {
    if (!row.createdById) continue;
    const entry = { currencyId: row.currencyId, total: Math.round((row._sum.totalAmount ?? 0) * 100) / 100 };
    const arr = revenueMap.get(row.createdById);
    if (arr) arr.push(entry); else revenueMap.set(row.createdById, [entry]);
  }

  // Build: Map<createdById, Date | null>
  const lastOrderMap = new Map<string, Date | null>();
  for (const row of lastOrderRows) {
    if (row.createdById) lastOrderMap.set(row.createdById, row._max.orderDate);
  }

  const results = employees.map((emp) => {
    const statusCounts = countMap.get(emp.id) ?? new Map<string, number>();
    const total     = [...statusCounts.values()].reduce((s, c) => s + c, 0);
    const delivered = [...statusCounts.entries()]
      .filter(([sid]) => deliveredPrimaryIds.has(sid))
      .reduce((s, [, c]) => s + c, 0);
    const returned  = returnedId  ? (statusCounts.get(returnedId)  ?? 0) : 0;
    const cancelled = cancelledId ? (statusCounts.get(cancelledId) ?? 0) : 0;
    const inProgress    = total - delivered - returned - cancelled;
    const deliveryRate  = total > 0 ? Math.round((delivered / total) * 100) : 0;

    const revenueByCurrency = (revenueMap.get(emp.id) ?? [])
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((r) => ({ currencyCode: currencyMap.get(r.currencyId) ?? "?", total: r.total }));
    const totalRevenue = revenueByCurrency.reduce((s, r) => s + r.total, 0);

    return {
      id:            emp.id,
      name:          emp.name,
      role:          emp.role,
      team:          emp.team,
      total,
      delivered,
      returned,
      cancelled,
      shipped:       inProgress,
      inProgress,
      deliveryRate,
      totalRevenue,
      revenue:       totalRevenue,
      avgOrderValue: total > 0 ? Math.round((totalRevenue / total) * 100) / 100 : 0,
      revenueByCurrency,
      lastOrderDate: lastOrderMap.get(emp.id)?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ data: results.sort((a, b) => b.total - a.total) });
}
