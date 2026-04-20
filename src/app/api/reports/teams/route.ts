import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId: sessionTeamId } = session.user;

  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom   = searchParams.get("dateFrom");
  const dateTo     = searchParams.get("dateTo");
  const statusIds  = searchParams.getAll("status");
  const countryIds = searchParams.getAll("countryId");
  const currencyId = searchParams.get("currencyId");

  // For SALES_MANAGER: prefer User.teamId; fall back to team they manage
  let managedTeamId = sessionTeamId;
  if (role === "SALES_MANAGER" && !managedTeamId) {
    const managed = await prisma.team.findFirst({
      where: { managerId: userId },
      select: { id: true },
    });
    managedTeamId = managed?.id ?? null;
  }

  // Delivered: metadata-based. Returned/cancelled: name-based (no metadata flag).
  // "تم الشحن" removed — that status doesn't exist in seed data and was never correct.
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

  const teamWhere: Record<string, unknown> = {};
  if (role === "SALES_MANAGER" && managedTeamId) teamWhere.id = managedTeamId;

  const teams = await prisma.team.findMany({
    where: teamWhere,
    include: {
      manager: { select: { id: true, name: true } },
      members: { select: { id: true }, where: { isActive: true } },
    },
    orderBy: { name: "asc" },
  });

  if (teams.length === 0) return NextResponse.json({ data: [] });

  const teamIds    = teams.map((t) => t.id);
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

  const batchFilter = { ...baseFilter, teamId: { in: teamIds } };

  // Revenue filter excludes cancelled/returned to match totalOrders counting rule
  const excludedIds = [cancelledId, returnedId].filter((id): id is string => !!id);
  const revenueFilter: Record<string, unknown> = { ...batchFilter };
  if (statusIds.length === 0 && excludedIds.length > 0) {
    revenueFilter.statusId = { notIn: excludedIds };
  }

  // 2 batch queries replace 5+ × N per-team round-trips
  const [countsByStatus, revenueRows] = await Promise.all([
    prisma.order.groupBy({
      by: ["teamId", "statusId"],
      where: batchFilter,
      _count: { id: true },
    }),
    prisma.order.groupBy({
      by: ["teamId", "currencyId"],
      where: revenueFilter,
      _sum: { totalAmount: true },
    }),
  ]);

  // Build: Map<teamId, Map<statusId, count>>
  const countMap = new Map<string, Map<string, number>>();
  for (const row of countsByStatus) {
    if (!row.teamId) continue;
    if (!countMap.has(row.teamId)) countMap.set(row.teamId, new Map());
    countMap.get(row.teamId)!.set(row.statusId, row._count.id);
  }

  // Build: Map<teamId, {currencyId, total}[]>
  const revenueMap = new Map<string, { currencyId: string; total: number }[]>();
  for (const row of revenueRows) {
    if (!row.teamId) continue;
    const entry = { currencyId: row.currencyId, total: Math.round((row._sum.totalAmount ?? 0) * 100) / 100 };
    const arr = revenueMap.get(row.teamId);
    if (arr) arr.push(entry); else revenueMap.set(row.teamId, [entry]);
  }

  const results = teams.map((team) => {
    const statusCounts = countMap.get(team.id) ?? new Map<string, number>();

    const delivered = [...statusCounts.entries()]
      .filter(([sid]) => deliveredPrimaryIds.has(sid))
      .reduce((s, [, c]) => s + c, 0);
    const returned  = returnedId  ? (statusCounts.get(returnedId)  ?? 0) : 0;
    const cancelled = cancelledId ? (statusCounts.get(cancelledId) ?? 0) : 0;
    const allOrders = [...statusCounts.values()].reduce((s, c) => s + c, 0);

    // totalOrders excludes cancelled + returned (orders that entered but don't count toward performance)
    const total   = statusIds.length === 0 ? allOrders - returned - cancelled : allOrders;
    // shipped = in-transit: entered the performance pool but not yet delivered
    const shipped = total - delivered;

    const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

    const revenueByCurrency = (revenueMap.get(team.id) ?? [])
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((r) => ({ currencyCode: currencyMap.get(r.currencyId) ?? "?", total: r.total }));

    return {
      id:           team.id,
      name:         team.name,
      manager:      team.manager,
      memberCount:  team.members.length,
      totalOrders:  total,
      delivered,
      shipped,
      returned,
      cancelled,
      deliveryRate,
      revenueByCurrency,
    };
  });

  return NextResponse.json({
    data: results.sort((a, b) => b.totalOrders - a.totalOrders),
  });
}
