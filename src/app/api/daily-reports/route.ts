import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

const reportSchema = z.object({
  reportDate: z.string().min(1, "التاريخ مطلوب"),
  shiftStart: z.string().optional(),
  shiftEnd: z.string().optional(),
  reportData: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const filterUserId = searchParams.get("userId");
  const isManager = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR";

  const where: Record<string, unknown> = {};

  if (!isManager) {
    where.userId = userId;
  } else {
    if (filterUserId) {
      where.userId = filterUserId;
    } else if (role === "SALES_MANAGER" && teamId) {
      const teamUsers = await prisma.user.findMany({
        where: { teamId },
        select: { id: true },
      });
      where.userId = { in: teamUsers.map((u) => u.id) };
    }
  }

  if (dateFrom) where.reportDate = { gte: new Date(dateFrom) };
  if (dateTo) {
    where.reportDate = {
      ...(where.reportDate as object ?? {}),
      lte: new Date(dateTo),
    };
  }

  const reports = await prisma.dailyReport.findMany({
    where,
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { reportDate: "desc" },
  });

  let missingToday: { id: string; name: string; role: string }[] = [];
  if (isManager) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    // missingToday: only check FOLLOWUP employees — self-reports are restricted to that role
    const teamFilter: Record<string, unknown> = {
      isActive: true,
      role: "FOLLOWUP",
    };
    if (role === "SALES_MANAGER" && teamId) teamFilter.teamId = teamId;
    const gmTeamId = searchParams.get("teamId");
    if (role === "GENERAL_MANAGER" && gmTeamId) teamFilter.teamId = gmTeamId;

    const allEmployees = await prisma.user.findMany({
      where: teamFilter,
      select: { id: true, name: true, role: true },
    });

    const submittedIds = new Set(
      reports
        .filter((r) => r.reportDate.toISOString().split("T")[0] === todayStr)
        .map((r) => r.userId)
    );

    missingToday = allEmployees
      .filter((e) => !submittedIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, role: e.role }));
  }

  return NextResponse.json({ data: reports, missingToday });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { id: userId, role } = session.user;

  const reportAllowedRoles = ["FOLLOWUP", "SALES", "SUPPORT", "SHIPPING", "SALES_MANAGER"];
  if (!reportAllowedRoles.includes(role)) {
    return NextResponse.json({ error: "غير مصرح بتقديم التقارير اليومية" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 }
    );
  }

  const { reportDate, shiftStart, shiftEnd, reportData, notes } = parsed.data;
  const dateOnly = new Date(reportDate);
  dateOnly.setHours(0, 0, 0, 0);

  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const threeDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 0, 0, 0, 0);

  if (dateOnly > todayEnd) {
    return NextResponse.json({ error: "لا يمكن تقديم تقرير لتاريخ مستقبلي" }, { status: 400 });
  }
  if (dateOnly < threeDaysAgo) {
    return NextResponse.json({ error: "لا يمكن تقديم تقرير لتاريخ أقدم من 3 أيام" }, { status: 400 });
  }

  const report = await prisma.$transaction(async (tx) => {
    const result = await tx.dailyReport.upsert({
      where: { userId_reportDate: { userId, reportDate: dateOnly } },
      create: {
        userId,
        reportDate: dateOnly,
        shiftStart: shiftStart ?? null,
        shiftEnd: shiftEnd ?? null,
        reportData: reportData as Prisma.InputJsonValue,
        notes: notes ?? null,
      },
      update: {
        shiftStart: shiftStart ?? null,
        shiftEnd: shiftEnd ?? null,
        reportData: reportData as Prisma.InputJsonValue,
        notes: notes ?? null,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    await logActivity(tx, {
      userId,
      action: "UPSERT_DAILY_REPORT",
      entityType: "DailyReport",
      entityId: result.id,
      details: { reportDate },
    });

    return result;
  });

  return NextResponse.json({ data: report }, { status: 201 });
}
