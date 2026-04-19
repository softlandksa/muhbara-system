import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, teamId } = session.user;
  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER" && role !== "HR") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const statusIds = searchParams.getAll("status");
  const countryIds = searchParams.getAll("countryId");
  const currencyId = searchParams.get("currencyId");
  const filterTeamId = searchParams.get("teamId");

  // Fetch named statuses and employees in parallel
  const [deliveredStatus, returnedStatus, cancelledStatus, employees] = await Promise.all([
    prisma.shippingStatusPrimary.findFirst({ where: { name: "تم التوصيل" } }),
    prisma.shippingStatusPrimary.findFirst({ where: { name: "مرتجع" } }),
    prisma.shippingStatusPrimary.findFirst({ where: { name: "ملغي" } }),
    prisma.user.findMany({
      where: {
        role: { in: ["SALES", "SALES_MANAGER"] },
        isActive: true,
        ...(role === "SALES_MANAGER" && teamId ? { teamId } : {}),
        ...((role === "ADMIN" || role === "GENERAL_MANAGER") && filterTeamId ? { teamId: filterTeamId } : {}),
      },
      select: { id: true, name: true, role: true, team: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  if (employees.length === 0) {
    return NextResponse.json({ summary: { total: 0, delivered: 0, returned: 0, cancelled: 0, inProgress: 0, totalRevenue: 0 }, employees: [] });
  }

  const employeeIds = employees.map((e) => e.id);

  // Base order filter
  const orderWhere: Record<string, unknown> = {
    deletedAt: null,
    createdById: { in: employeeIds },
  };
  if (role === "SALES_MANAGER" && teamId) orderWhere.teamId = teamId;
  if ((role === "ADMIN" || role === "GENERAL_MANAGER") && filterTeamId) orderWhere.teamId = filterTeamId;
  if (dateFrom || dateTo) {
    const dw: Record<string, unknown> = {};
    if (dateFrom) dw.gte = new Date(dateFrom);
    if (dateTo) dw.lte = endOfDay(new Date(dateTo));
    orderWhere.orderDate = dw;
  }
  if (statusIds.length > 0) orderWhere.statusId = { in: statusIds };
  if (countryIds.length > 0) orderWhere.countryId = { in: countryIds };
  if (currencyId) orderWhere.currencyId = currencyId;

  // 4 batch queries instead of 6 × N per-employee queries
  const [statsGroups, deliveredGroups, returnedGroups, cancelledGroups] = await Promise.all([
    // Total orders + revenue + last order date per employee
    prisma.order.groupBy({
      by: ["createdById"],
      where: orderWhere,
      _count: { id: true },
      _sum: { totalAmount: true },
      _max: { orderDate: true },
    }),
    // Delivered count per employee
    deliveredStatus
      ? prisma.order.groupBy({
          by: ["createdById"],
          where: { ...orderWhere, statusId: deliveredStatus.id },
          _count: { id: true },
        })
      : Promise.resolve([] as { createdById: string; _count: { id: number } }[]),
    // Returned count per employee
    returnedStatus
      ? prisma.order.groupBy({
          by: ["createdById"],
          where: { ...orderWhere, statusId: returnedStatus.id },
          _count: { id: true },
        })
      : Promise.resolve([] as { createdById: string; _count: { id: number } }[]),
    // Cancelled count per employee
    cancelledStatus
      ? prisma.order.groupBy({
          by: ["createdById"],
          where: { ...orderWhere, statusId: cancelledStatus.id },
          _count: { id: true },
        })
      : Promise.resolve([] as { createdById: string; _count: { id: number } }[]),
  ]);

  // Build lookup maps from groupBy results
  const statsMap = new Map(statsGroups.map((g) => [g.createdById, g]));
  const deliveredMap = new Map(deliveredGroups.map((g) => [g.createdById, g._count.id]));
  const returnedMap = new Map(returnedGroups.map((g) => [g.createdById, g._count.id]));
  const cancelledMap = new Map(cancelledGroups.map((g) => [g.createdById, g._count.id]));

  const employeeStats = employees.map((emp) => {
    const stats = statsMap.get(emp.id);
    const total = stats?._count.id ?? 0;
    const delivered = deliveredMap.get(emp.id) ?? 0;
    const returned = returnedMap.get(emp.id) ?? 0;
    const cancelled = cancelledMap.get(emp.id) ?? 0;
    const inProgress = total - delivered - returned - cancelled;
    const revenue = stats?._sum.totalAmount ?? 0;
    const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
    return {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      team: emp.team,
      total,
      delivered,
      returned,
      cancelled,
      inProgress,
      revenue: Math.round(revenue * 100) / 100,
      deliveryRate,
      lastOrderDate: stats?._max.orderDate?.toISOString() ?? null,
    };
  });

  const summary = employeeStats.reduce(
    (acc, emp) => ({
      total: acc.total + emp.total,
      delivered: acc.delivered + emp.delivered,
      returned: acc.returned + emp.returned,
      cancelled: acc.cancelled + emp.cancelled,
      inProgress: acc.inProgress + emp.inProgress,
      totalRevenue: +(acc.totalRevenue + emp.revenue).toFixed(2),
    }),
    { total: 0, delivered: 0, returned: 0, cancelled: 0, inProgress: 0, totalRevenue: 0 }
  );

  return NextResponse.json({
    summary,
    employees: employeeStats.sort((a, b) => b.total - a.total),
  });
}
