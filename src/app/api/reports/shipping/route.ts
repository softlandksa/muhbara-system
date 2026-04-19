import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrderCountsByPrimary } from "@/lib/shipping-stats";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role, teamId } = session.user;
  const allowed = ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SHIPPING"];
  if (!allowed.includes(role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo   = searchParams.get("dateTo");

  // Build the shipping-date range filter (applied to ShippingInfo.shippedAt).
  const shippedAtFilter: Record<string, unknown> = {};
  if (dateFrom) shippedAtFilter.gte = new Date(dateFrom);
  if (dateTo)   shippedAtFilter.lte = new Date(dateTo + "T23:59:59");
  const hasDateFilter = Object.keys(shippedAtFilter).length > 0;

  // infoWhere: scopes ShippingInfo rows for summary stats + dailyChart.
  // Date field: ShippingInfo.shippedAt (physical shipment date).
  const infoWhere: Record<string, unknown> = {};
  if (hasDateFilter) infoWhere.shippedAt = shippedAtFilter;
  // SALES_MANAGER: scope to their team's orders only.
  if (role === "SALES_MANAGER" && teamId) infoWhere.order = { teamId };

  // primaryOrderWhere: counts by Order.statusId for the bar chart, pie, table, Excel.
  // MUST NOT require ShippingInfo — orders in «جاهز للشحن» often have no ShippingInfo yet.
  // Same team scope as shipping rows for SALES_MANAGER; ADMIN / GENERAL_MANAGER / SHIPPING see all.
  const primaryOrderWhere: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) primaryOrderWhere.teamId = teamId;

  try {
    const [quickStats, shippingInfos] = await Promise.all([
      getOrderCountsByPrimary(primaryOrderWhere),
      prisma.shippingInfo.findMany({
        where: infoWhere,
        select: { shippedAt: true },
      }),
    ]);

    // §12.4: primaries list — ALL active primaries including those with count=0 (LEFT JOIN
    // pattern: getOrderCountsByPrimary maps zeros via countMap[p.id] ?? 0).
    const primaries = quickStats.map(p => ({
      id:        p.id,
      name:      p.name,
      color:     p.color,
      count:     p.count,
      // delivered per row: if this primary IS a delivered bucket, all its orders are
      // delivered; otherwise 0 (an order can only be in one bucket at a time).
      delivered: p.isDeliveredBucket ? p.count : 0,
    }));

    // §12.4: aggregate totals for the table header row.
    const totals = {
      orderCount:    primaries.reduce((s, p) => s + p.count, 0),
      deliveredCount: primaries.reduce((s, p) => s + p.delivered, 0),
    };

    const totalOrders    = totals.orderCount;
    const deliveredCount = totals.deliveredCount;
    if (deliveredCount > totalOrders) {
      console.error("[reports/shipping] INVARIANT VIOLATION: deliveredCount > totalOrders", {
        totalOrders,
        deliveredCount,
      });
    }
    // Daily chart: group ShippingInfo by shippedAt date (physical shipment actions).
    const byDay: Record<string, number> = {};
    for (const info of shippingInfos) {
      if (!info.shippedAt) continue;
      const d = info.shippedAt.toISOString().slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) + 1;
    }
    const dailyChart = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json({
      data: {
        summary: { totalOrders, deliveredCount },
        primaries,
        totals,
        dailyChart,
      },
    });
  } catch (e) {
    console.error("[reports/shipping]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}
