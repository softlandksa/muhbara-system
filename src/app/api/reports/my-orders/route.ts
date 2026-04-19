import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (role !== "SALES" && role !== "FOLLOWUP") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo   = searchParams.get("dateTo");

  // userId always comes from session — ignore any client-supplied value
  const baseWhere: Record<string, unknown> = { deletedAt: null };

  if (role === "SALES") {
    baseWhere.createdById = userId;
  } else {
    // FOLLOWUP: orders they have added at least one follow-up note on
    baseWhere.followUpNotes = { some: { createdById: userId } };
  }

  if (dateFrom || dateTo) {
    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo)   dateFilter.lte = new Date(dateTo + "T23:59:59");
    baseWhere.orderDate = dateFilter;
  }

  try {
    const [orders, totalAgg, statusGroups, shippingInfos] = await Promise.all([
      // Summary orders list (capped at 100)
      prisma.order.findMany({
        where: baseWhere,
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          customerName: true,
          totalAmount: true,
          status: { select: { id: true, name: true, color: true } },
          currency: { select: { code: true } },
          shippingInfo: {
            select: {
              id: true,
              shippingSubStatus: {
                select: {
                  primaryId: true,
                  primary: { select: { id: true, name: true, color: true } },
                },
              },
            },
          },
        },
        orderBy: { orderDate: "desc" },
        take: 100,
      }),

      prisma.order.aggregate({
        where: baseWhere,
        _count: { id: true },
        _sum: { totalAmount: true },
      }),

      // Status breakdown
      prisma.order.groupBy({
        by: ["statusId"],
        where: baseWhere,
        _count: { id: true },
      }),

      // Shipping primary breakdown (for shipped subset)
      prisma.shippingInfo.findMany({
        where: {
          order: baseWhere,
        },
        select: {
          shippingSubStatus: {
            select: {
              primaryId: true,
              primary: { select: { id: true, name: true, color: true } },
            },
          },
        },
      }),
    ]);

    // Resolve status IDs to names
    const statusIdList = statusGroups.map(g => g.statusId);
    const statuses = statusIdList.length > 0
      ? await prisma.shippingStatusPrimary.findMany({
          where: { id: { in: statusIdList } },
          select: { id: true, name: true, color: true },
        })
      : [];
    const statusMap = new Map(statuses.map(s => [s.id, s]));

    const statusChart = statusGroups.map(g => {
      const s = statusMap.get(g.statusId);
      return { name: s?.name ?? g.statusId, color: s?.color ?? "#6b7280", count: g._count.id };
    }).sort((a, b) => b.count - a.count);

    // Shipping primary breakdown
    const shippingCountByPrimary = new Map<string, { name: string; color: string; count: number }>();
    for (const info of shippingInfos) {
      const p = info.shippingSubStatus?.primary;
      if (!p) continue;
      const existing = shippingCountByPrimary.get(p.id);
      if (existing) existing.count++;
      else shippingCountByPrimary.set(p.id, { name: p.name, color: p.color, count: 1 });
    }
    const shippingPrimaryChart = Array.from(shippingCountByPrimary.values())
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      data: {
        summary: {
          total: totalAgg._count.id,
          totalRevenue: Math.round((totalAgg._sum.totalAmount ?? 0) * 100) / 100,
          shipped: shippingInfos.length,
        },
        statusChart,
        shippingPrimaryChart,
        orders,
      },
    });
  } catch (e) {
    console.error("[reports/my-orders]", e);
    return NextResponse.json({ error: "حدث خطأ في الخادم" }, { status: 500 });
  }
}
