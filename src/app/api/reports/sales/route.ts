import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay, format } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, teamId } = session.user;
  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const countryIds = searchParams.getAll("countryId");
  const currencyId = searchParams.get("currencyId");
  const paymentMethodId = searchParams.get("paymentMethodId");
  const statusIds = searchParams.getAll("status");
  const filterUserId = searchParams.get("userId");
  const filterTeamId = searchParams.get("teamId");

  const where: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) where.teamId = teamId;
  if ((role === "ADMIN" || role === "GENERAL_MANAGER") && filterTeamId) where.teamId = filterTeamId;
  if (filterUserId) where.createdById = filterUserId;
  if (countryIds.length > 0) where.countryId = { in: countryIds };
  if (currencyId) where.currencyId = currencyId;
  if (paymentMethodId) where.paymentMethodId = paymentMethodId;
  if (statusIds.length > 0) where.statusId = { in: statusIds };
  if (dateFrom || dateTo) {
    const dateWhere: Record<string, unknown> = {};
    if (dateFrom) dateWhere.gte = new Date(dateFrom);
    if (dateTo) dateWhere.lte = endOfDay(new Date(dateTo));
    where.orderDate = dateWhere;
  }

  // Run all queries in parallel:
  // - tableOrders: paginated list for the detail table (max 100)
  // - summary: count + sum via aggregate (single SQL aggregation)
  // - dailyOrders: minimal fields for daily chart (no joins)
  // - groupBy queries for chart breakdowns (pure SQL aggregation, no row transfer)
  const [
    tableOrders,
    summaryAgg,
    dailyOrders,
    countryGroups,
    currencyGroups,
    paymentGroups,
    statusGroups,
  ] = await Promise.all([
    // Table: capped at 100, full select
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        customerName: true,
        statusId: true,
        status: { select: { id: true, name: true, color: true } },
        totalAmount: true,
        country: { select: { id: true, name: true } },
        currency: { select: { id: true, code: true, symbol: true } },
        paymentMethod: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { orderDate: "desc" },
      take: 100,
    }),

    // Summary: single aggregate query
    prisma.order.aggregate({
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
    }),

    // Daily chart: only date + amount fields — no relation joins
    prisma.order.findMany({
      where,
      select: { orderDate: true, totalAmount: true },
    }),

    // Chart aggregations via groupBy (all done in SQL)
    prisma.order.groupBy({
      by: ["countryId"],
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prisma.order.groupBy({
      by: ["currencyId"],
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ["paymentMethodId"],
      where,
      _count: { id: true },
    }),
    prisma.order.groupBy({
      by: ["statusId"],
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
  ]);

  // Resolve IDs to names for chart data — batch lookup by IDs actually used
  const countryIdList = countryGroups.map((g) => g.countryId);
  const currencyIdList = currencyGroups.map((g) => g.currencyId);
  const paymentIdList = paymentGroups.map((g) => g.paymentMethodId);
  const statusIdList = statusGroups.map((g) => g.statusId);

  const [countries, currencies, payments, statuses] = await Promise.all([
    countryIdList.length > 0
      ? prisma.country.findMany({ where: { id: { in: countryIdList } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    currencyIdList.length > 0
      ? prisma.currency.findMany({ where: { id: { in: currencyIdList } }, select: { id: true, code: true, name: true } })
      : Promise.resolve([]),
    paymentIdList.length > 0
      ? prisma.paymentMethod.findMany({ where: { id: { in: paymentIdList } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    statusIdList.length > 0
      ? prisma.shippingStatusPrimary.findMany({ where: { id: { in: statusIdList } }, select: { id: true, name: true, color: true } })
      : Promise.resolve([]),
  ]);

  const countryMap = new Map(countries.map((c) => [c.id, c.name]));
  const currencyMap = new Map(currencies.map((c) => [c.id, c.code]));
  const paymentMap = new Map(payments.map((p) => [p.id, p.name]));
  const statusMap = new Map(statuses.map((s) => [s.id, s]));

  // Build daily chart — group in JS (no date-trunc in Prisma groupBy)
  const byDay: Record<string, { count: number; revenue: number }> = {};
  for (const o of dailyOrders) {
    const d = format(new Date(o.orderDate), "yyyy-MM-dd");
    if (!byDay[d]) byDay[d] = { count: 0, revenue: 0 };
    byDay[d].count++;
    byDay[d].revenue += o.totalAmount;
  }
  const dailyChart = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, count: v.count, revenue: Math.round(v.revenue * 100) / 100 }));

  const countryChart = countryGroups.map((g) => ({
    name: countryMap.get(g.countryId) ?? g.countryId,
    count: g._count.id,
    revenue: Math.round((g._sum.totalAmount ?? 0) * 100) / 100,
  }));

  const currencyChart = currencyGroups.map((g) => ({
    name: currencyMap.get(g.currencyId) ?? g.currencyId,
    value: g._count.id,
    revenue: Math.round((g._sum.totalAmount ?? 0) * 100) / 100,
  }));

  const paymentChart = paymentGroups.map((g) => ({
    name: paymentMap.get(g.paymentMethodId) ?? g.paymentMethodId,
    value: g._count.id,
  }));

  const statusChart = statusGroups.map((g) => {
    const s = statusMap.get(g.statusId);
    return {
      name: s?.name ?? g.statusId,
      color: s?.color ?? "#6b7280",
      count: g._count.id,
      revenue: Math.round((g._sum.totalAmount ?? 0) * 100) / 100,
    };
  });

  const totalCount = summaryAgg._count.id;
  const totalRevenue = summaryAgg._sum.totalAmount ?? 0;

  return NextResponse.json({
    data: {
      orders: tableOrders,
      summary: { total: totalCount, totalRevenue: Math.round(totalRevenue * 100) / 100 },
      dailyChart,
      countryChart,
      currencyChart,
      paymentChart,
      statusChart,
    },
  });
}
