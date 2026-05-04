import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

const ALLOWED_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER", "SHIPPING"];

type RunRow = {
  id: string;
  finishedAt: Date | null;
  status: string;
  triggeredBy: string;
  triggeredByUserId: string | null;
  errorSummary: string | null;
};

type UserInfo = { name: string; email: string; role: string };

type SyncEntry = {
  id: string;
  finishedAt: Date | null;
  status: string;
  triggeredBy: string;
  errorSummary: string | null;
  updatedBy: UserInfo | null;
} | null;

const RUN_SELECT = {
  id: true,
  finishedAt: true,
  status: true,
  triggeredBy: true,
  triggeredByUserId: true,
  errorSummary: true,
} as const;

async function getLastRun(mode: "update" | "resync"): Promise<RunRow | null> {
  return prisma.googleSheetSyncRun.findFirst({
    where: { status: { in: ["COMPLETED", "FAILED"] }, mode },
    orderBy: { startedAt: "desc" },
    select: RUN_SELECT,
  });
}

async function resolveUser(userId: string | null): Promise<UserInfo | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, role: true },
  });
  return user ?? null;
}

function toEntry(run: RunRow | null, updatedBy: UserInfo | null): SyncEntry {
  if (!run) return null;
  const { triggeredByUserId: _, ...rest } = run;
  return { ...rest, updatedBy };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role } = session.user;
  if (!ALLOWED_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  // Query last run per mode. mode column requires db push — fall back gracefully.
  let lastUpdate: RunRow | null = null;
  let lastResync: RunRow | null = null;

  try {
    [lastUpdate, lastResync] = await Promise.all([
      getLastRun("update"),
      getLastRun("resync"),
    ]);
  } catch {
    // mode column not in DB yet — show latest run as "update"
    try {
      const fallback = await prisma.googleSheetSyncRun.findFirst({
        where: { status: { in: ["COMPLETED", "FAILED"] } },
        orderBy: { startedAt: "desc" },
        select: RUN_SELECT,
      });
      if (fallback) lastUpdate = fallback;
    } catch { /* table entirely missing */ }
  }

  const [updateUser, resyncUser] = await Promise.all([
    resolveUser(lastUpdate?.triggeredByUserId ?? null),
    resolveUser(lastResync?.triggeredByUserId ?? null),
  ]);

  return NextResponse.json({
    update: toEntry(lastUpdate, updateUser),
    resync: toEntry(lastResync, resyncUser),
  });
}
