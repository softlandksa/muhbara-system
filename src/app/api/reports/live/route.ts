import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay, subDays, startOfMonth } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type RawGroupRow = {
  createdById: string;
  statusId: string;
  _count: { id: number };
  _sum: { totalAmount: number | null };
};

export type StatusInfo = { id: string; name: string; color: string };

export type PeriodStat = {
  count: number;
  revenue: number;
  byStatus: {
    statusId: string;
    name: string;
    color: string;
    count: number;
    revenue: number;
  }[];
};

export type EmployeeLiveStat = {
  id: string;
  name: string;
  role: string;
  today: PeriodStat;
  yesterday: PeriodStat;
  last7days: PeriodStat;
  thisMonth: PeriodStat;
};

export type LiveReportData = {
  overall: {
    today: PeriodStat;
    yesterday: PeriodStat;
    last7days: PeriodStat;
    thisMonth: PeriodStat;
  };
  employees: EmployeeLiveStat[];
  statuses: StatusInfo[];
  updatedAt: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPeriodStat(rows: RawGroupRow[], statuses: StatusInfo[]): PeriodStat {
  const count = rows.reduce((s, r) => s + r._count.id, 0);
  const revenue = rows.reduce((s, r) => s + (r._sum.totalAmount ?? 0), 0);

  const byStatusMap: Record<string, { count: number; revenue: number }> = {};
  for (const row of rows) {
    if (!byStatusMap[row.statusId]) byStatusMap[row.statusId] = { count: 0, revenue: 0 };
    byStatusMap[row.statusId].count += row._count.id;
    byStatusMap[row.statusId].revenue += row._sum.totalAmount ?? 0;
  }

  const byStatus = statuses.map((s) => ({
    statusId: s.id,
    name: s.name,
    color: s.color,
    count: byStatusMap[s.id]?.count ?? 0,
    revenue: Math.round((byStatusMap[s.id]?.revenue ?? 0) * 100) / 100,
  }));

  return {
    count,
    revenue: Math.round(revenue * 100) / 100,
    byStatus,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role, id: userId, teamId: sessionTeamId } = session.user;

  // Resolve managed team for SALES_MANAGER (handles missing User.teamId edge case)
  let managedTeamId: string | null = sessionTeamId ?? null;
  if (role === "SALES_MANAGER" && !managedTeamId) {
    const managed = await prisma.team.findFirst({
      where: { managerId: userId },
      select: { id: true },
    });
    managedTeamId = managed?.id ?? null;
  }

  // Base WHERE clause: role-scoped, excludes soft-deleted orders
  const baseWhere: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && managedTeamId) {
    baseWhere.teamId = managedTeamId;
  } else if (role !== "ADMIN" && role !== "GENERAL_MANAGER") {
    // All other roles (SALES, SUPPORT, etc.) see only their own orders
    baseWhere.createdById = userId;
  }

  // Build the four period date ranges using server time (consistent with other reports)
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const yesterdayEnd = endOfDay(subDays(now, 1));
  const last7Start = startOfDay(subDays(now, 6)); // today is day 1, so 6 days back = 7-day window
  const monthStart = startOfMonth(now);

  const withPeriod = (start: Date, end: Date) => ({
    ...baseWhere,
    orderDate: { gte: start, lte: end },
  });

  // Run all heavy queries in a single parallel batch
  const [statuses, todayRows, yesterdayRows, last7Rows, monthRows] = await Promise.all([
    prisma.shippingStatusPrimary.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.order.groupBy({
      by: ["createdById", "statusId"],
      where: withPeriod(todayStart, todayEnd),
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ["createdById", "statusId"],
      where: withPeriod(yesterdayStart, yesterdayEnd),
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ["createdById", "statusId"],
      where: withPeriod(last7Start, todayEnd),
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ["createdById", "statusId"],
      where: withPeriod(monthStart, todayEnd),
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
  ]);

  // Collect unique employee IDs from all result rows
  const allRows = [...todayRows, ...yesterdayRows, ...last7Rows, ...monthRows];
  const seenEmployeeIds = [...new Set(allRows.map((r) => r.createdById))];

  // Fetch the employee list based on role scope
  let employees: { id: string; name: string; role: string }[];

  if (role === "ADMIN" || role === "GENERAL_MANAGER") {
    // Show only employees who have at least one order in any of the 4 periods
    employees = await prisma.user.findMany({
      where: { isActive: true, id: { in: seenEmployeeIds } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
  } else if (role === "SALES_MANAGER" && managedTeamId) {
    // Show all active team members (including those with 0 orders in range)
    const teamMembers = await prisma.user.findMany({
      where: { isActive: true, teamId: managedTeamId },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    // Include any employees from results not on the team (edge case: ex-members)
    const teamMemberIds = new Set(teamMembers.map((u) => u.id));
    const extraIds = seenEmployeeIds.filter((id) => !teamMemberIds.has(id));
    if (extraIds.length > 0) {
      const extra = await prisma.user.findMany({
        where: { id: { in: extraIds } },
        select: { id: true, name: true, role: true },
      });
      employees = [...teamMembers, ...extra];
    } else {
      employees = teamMembers;
    }
  } else {
    // Own data only — security boundary: other employees are never returned
    const self = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    });
    employees = self ? [self] : [];
  }

  // Build overall period stats (across all visible employees)
  const overall = {
    today: buildPeriodStat(todayRows, statuses),
    yesterday: buildPeriodStat(yesterdayRows, statuses),
    last7days: buildPeriodStat(last7Rows, statuses),
    thisMonth: buildPeriodStat(monthRows, statuses),
  };

  // Build per-employee period stats
  const employeeStats: EmployeeLiveStat[] = employees.map((emp) => ({
    id: emp.id,
    name: emp.name,
    role: emp.role,
    today: buildPeriodStat(
      todayRows.filter((r) => r.createdById === emp.id),
      statuses
    ),
    yesterday: buildPeriodStat(
      yesterdayRows.filter((r) => r.createdById === emp.id),
      statuses
    ),
    last7days: buildPeriodStat(
      last7Rows.filter((r) => r.createdById === emp.id),
      statuses
    ),
    thisMonth: buildPeriodStat(
      monthRows.filter((r) => r.createdById === emp.id),
      statuses
    ),
  }));

  return NextResponse.json({
    data: {
      overall,
      employees: employeeStats,
      statuses,
      updatedAt: now.toISOString(),
    } satisfies LiveReportData,
  });
}
