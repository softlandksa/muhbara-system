import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const [totalOrders, visibleOrders, softDeletedOrders] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { deletedAt: null } }),
    prisma.order.count({ where: { deletedAt: { not: null } } }),
  ]);

  // source field requires db push — handle gracefully if column missing
  let googleSheetsOrders: number | null = null;
  let manualOrders: number | null = null;
  let sourceNote: string | undefined;
  try {
    [googleSheetsOrders, manualOrders] = await Promise.all([
      prisma.order.count({ where: { source: "GOOGLE_SHEETS" } }),
      prisma.order.count({ where: { source: "MANUAL" } }),
    ]);
  } catch (err) {
    sourceNote = err instanceof Error ? err.message.split("\n")[0] : "source column may not exist — run npx prisma db push";
  }

  // Import log counts for cross-reference
  let syncedLogs = 0;
  let deletedLogs = 0;
  try {
    [syncedLogs, deletedLogs] = await Promise.all([
      prisma.googleSheetImportLog.count({ where: { status: "SYNCED" } }),
      prisma.googleSheetImportLog.count({ where: { status: "DELETED" } }),
    ]);
  } catch { /* table may not exist */ }

  return NextResponse.json({
    data: {
      totalOrders,
      visibleOrders,
      softDeletedOrders,
      hiddenOrders: softDeletedOrders,
      googleSheetsOrders,
      manualOrders,
      importLog: { synced: syncedLogs, deleted: deletedLogs },
      ...(sourceNote && { sourceNote }),
    },
  });
}
