import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

const ALLOWED_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER", "SHIPPING"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role } = session.user;
  if (!ALLOWED_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const last = await prisma.googleSheetSyncRun.findFirst({
    where: { status: { in: ["COMPLETED", "FAILED"] } },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      finishedAt: true,
      status: true,
      totalSheets: true,
      sheetsSkipped: true,
      totalRows: true,
      importedCount: true,
      skippedCount: true,
      duplicateCount: true,
      failedCount: true,
      triggeredBy: true,
      triggeredByUserId: true,
      errorSummary: true,
    },
  });

  if (!last) return NextResponse.json({ data: null });

  let updatedBy: { name: string; email: string; role: string } | null = null;
  if (last.triggeredByUserId) {
    const user = await prisma.user.findUnique({
      where: { id: last.triggeredByUserId },
      select: { name: true, email: true, role: true },
    });
    if (user) updatedBy = user;
  }

  const { triggeredByUserId: _omit, ...rest } = last;
  return NextResponse.json({ data: { ...rest, updatedBy } });
}
