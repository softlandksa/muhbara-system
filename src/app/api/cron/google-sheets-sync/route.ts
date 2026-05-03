import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runGoogleSheetsImport } from "@/lib/google-sheets-import";

/**
 * Vercel Cron endpoint — called every 12 hours.
 * Protected by GOOGLE_SHEETS_SYNC_SECRET (or Vercel's CRON_SECRET).
 * In production, requests without the correct Authorization header are rejected.
 */
export async function GET(request: NextRequest) {
  const secret =
    process.env.GOOGLE_SHEETS_SYNC_SECRET ?? process.env.CRON_SECRET;

  if (secret) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "GOOGLE_SHEETS_SYNC_SECRET غير مكوّن — الطلب مرفوض في بيئة الإنتاج" },
      { status: 401 }
    );
  }

  const missingVars: string[] = [];
  const hasJson  = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const hasEmail = !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const hasKey   = !!process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!hasJson && !(hasEmail && hasKey)) {
    missingVars.push(
      !hasEmail && !hasKey ? "GOOGLE_SERVICE_ACCOUNT_JSON" : !hasEmail ? "GOOGLE_SHEETS_CLIENT_EMAIL" : "GOOGLE_SHEETS_PRIVATE_KEY"
    );
  }
  if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID) missingVars.push("GOOGLE_SHEETS_SPREADSHEET_ID");

  if (missingVars.length > 0) {
    console.warn("[cron/google-sheets-sync] Missing env vars:", missingVars);
    return NextResponse.json(
      { error: `متغيرات البيئة مفقودة: ${missingVars.join(", ")}` },
      { status: 503 }
    );
  }

  const running = await prisma.googleSheetSyncRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (running) {
    return NextResponse.json({ message: "مزامنة قيد التشغيل — تم التخطي" });
  }

  try {
    const result = await runGoogleSheetsImport("CRON");
    console.log(
      `[cron/google-sheets-sync] completed — ` +
      `sheets:${result.totalSheets} (skipped:${result.sheetsSkipped}) ` +
      `rows:${result.totalRows} imported:${result.importedCount} ` +
      `duplicates:${result.duplicateCount} skipped:${result.skippedCount} failed:${result.failedCount}`
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[cron/google-sheets-sync] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ غير متوقع" },
      { status: 500 }
    );
  }
}
