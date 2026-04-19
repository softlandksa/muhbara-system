import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrderCountsByPrimary } from "@/lib/shipping-stats";
import { subDays, startOfDay, endOfDay, format } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const filterTeamId = searchParams.get("teamId");

  // Role-based order filter — no status restriction
  const roleWhere: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) roleWhere.teamId = teamId;
  if (role === "SALES") roleWhere.createdById = userId;
  if ((role === "ADMIN" || role === "GENERAL_MANAGER") && filterTeamId) roleWhere.teamId = filterTeamId;

  // Date filter applies to Order.orderDate (when the order was placed, not delivered).
  // The shipping report uses ShippingInfo.shippedAt instead — intentionally different scope.
  if (dateFrom || dateTo) {
    const dateWhere: Record<string, unknown> = {};
    if (dateFrom) dateWhere.gte = new Date(dateFrom);
    if (dateTo) dateWhere.lte = endOfDay(new Date(dateTo));
    roleWhere.orderDate = dateWhere;
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  // §12.1: aggregate by primary via shared helper (no hardcoded status names)
  const [statuses, total, todayOrders] = await Promise.all([
    getOrderCountsByPrimary(roleWhere),
    prisma.order.count({ where: roleWhere }),
    prisma.order.count({
      where: { ...roleWhere, orderDate: { gte: todayStart, lte: todayEnd } },
    }),
  ]);

  // Derived: sum all isDeliveredBucket primaries for a quick delivered count
  const delivered = statuses
    .filter((s) => s.isDeliveredBucket)
    .reduce((sum, s) => sum + s.count, 0);

  // Status pie chart — only primaries that have orders
  const statusChart = statuses
    .filter((s) => s.count > 0)
    .map((s) => ({ name: s.name, value: s.count, color: s.color }));

  const thirtyDaysAgo = subDays(now, 29);

  const [dailyOrders, countryOrders, paymentOrders, recentOrders] = await Promise.all([
    prisma.order.findMany({
      where: { ...roleWhere, orderDate: { gte: startOfDay(thirtyDaysAgo) } },
      select: { orderDate: true, totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ["countryId"],
      where: roleWhere,
      _count: { id: true },
      _sum: { totalAmount: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prisma.order.groupBy({
      by: ["paymentMethodId"],
      where: roleWhere,
      _count: { id: true },
    }),
    prisma.order.findMany({
      where: roleWhere,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        statusId: true,
        status: { select: { name: true, color: true } },
        totalAmount: true,
        orderDate: true,
        country: { select: { name: true } },
        currency: { select: { code: true } },
      },
    }),
  ]);

  const [countries, paymentMethods] = await Promise.all([
    prisma.country.findMany({
      where: { id: { in: countryOrders.map((c) => c.countryId) } },
      select: { id: true, name: true },
    }),
    prisma.paymentMethod.findMany({
      where: { id: { in: paymentOrders.map((p) => p.paymentMethodId) } },
      select: { id: true, name: true },
    }),
  ]);

  const byDay: Record<string, { count: number; revenue: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = format(subDays(now, 29 - i), "yyyy-MM-dd");
    byDay[d] = { count: 0, revenue: 0 };
  }
  dailyOrders.forEach((o) => {
    const d = format(new Date(o.orderDate), "yyyy-MM-dd");
    if (byDay[d]) { byDay[d].count++; byDay[d].revenue += o.totalAmount; }
  });
  const dailyChart = Object.entries(byDay).map(([date, v]) => ({
    date,
    count: v.count,
    revenue: Math.round(v.revenue * 100) / 100,
  }));

  const countryMap = Object.fromEntries(countries.map((c) => [c.id, c.name]));
  const countryChart = countryOrders.map((c) => ({
    name: countryMap[c.countryId] ?? c.countryId,
    count: c._count.id,
    revenue: Math.round((c._sum.totalAmount ?? 0) * 100) / 100,
  }));

  const pmMap = Object.fromEntries(paymentMethods.map((p) => [p.id, p.name]));
  const paymentChart = paymentOrders.map((p) => ({
    name: pmMap[p.paymentMethodId] ?? p.paymentMethodId,
    value: p._count.id,
  }));

  return NextResponse.json({
    data: {
      stats: {
        total,
        todayOrders,
        delivered,
        // §12.1: dynamic array — one entry per active ShippingStatusPrimary.
        // UI must render cards from this array, not from hardcoded named fields.
        statuses,
      },
      dailyChart,
      statusChart,
      countryChart,
      paymentChart,
      recentOrders,
    },
  });
}
