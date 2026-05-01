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
      totalRows: true,
      importedCount: true,
      skippedCount: true,
      failedCount: true,
      triggeredBy: true,
      errorSummary: true,
    },
  });

  return NextResponse.json({ data: last });
}
