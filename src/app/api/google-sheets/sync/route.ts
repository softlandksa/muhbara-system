import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runGoogleSheetsImport } from "@/lib/google-sheets-import";
import type { Role } from "@/types";

const ALLOWED_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER", "SHIPPING"];

const REQUIRED_ENV_VARS = [
  "GOOGLE_SHEETS_CLIENT_EMAIL",
  "GOOGLE_SHEETS_PRIVATE_KEY",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
] as const;

function getMissingEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
}

export async function POST() {
  const isDev = process.env.NODE_ENV !== "production";

  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!ALLOWED_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  // ── Env var check ───────────────────────────────────────────────────────────
  const missing = getMissingEnvVars();
  if (missing.length > 0) {
    console.error(
      `[POST /api/google-sheets/sync] Missing env vars: ${missing.join(", ")}`
    );
    return NextResponse.json(
      {
        error: "إعدادات Google Sheets غير مكتملة. يرجى مراجعة مدير النظام.",
        ...(isDev && { debug: `Missing env vars: ${missing.join(", ")}` }),
      },
      { status: 503 }
    );
  }

  console.log(
    `[POST /api/google-sheets/sync] triggered by ${userId} (${role}) — env vars present: ${REQUIRED_ENV_VARS.join(", ")}`
  );

  // ── Prevent concurrent syncs ─────────────────────────────────────────────────
  const running = await prisma.googleSheetSyncRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (running) {
    console.log(
      `[POST /api/google-sheets/sync] sync already running (id: ${running.id}, started: ${running.startedAt.toISOString()})`
    );
    return NextResponse.json(
      { error: "عملية المزامنة قيد التشغيل بالفعل — يرجى الانتظار" },
      { status: 409 }
    );
  }

  // ── Run import ───────────────────────────────────────────────────────────────
  try {
    const result = await runGoogleSheetsImport("MANUAL", userId);
    console.log(
      `[POST /api/google-sheets/sync] completed — ` +
      `sheets:${result.totalSheets} (skipped:${result.sheetsSkipped}) ` +
      `rows:${result.totalRows} imported:${result.importedCount} ` +
      `duplicates:${result.duplicateCount} skipped:${result.skippedCount} failed:${result.failedCount}`
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    console.error("[POST /api/google-sheets/sync] error:", message);
    if (stack) console.error("[POST /api/google-sheets/sync] stack:", stack);

    let userMessage = "حدث خطأ أثناء المزامنة. يرجى المحاولة مرة أخرى.";
    let httpStatus = 500;

    if (
      message.includes("إعدادات Google Sheets") ||
      message.includes("GOOGLE_SHEETS") ||
      message.includes("client_email") ||
      message.includes("private_key") ||
      message.includes("OAuth")
    ) {
      userMessage = "إعدادات Google Sheets غير مكتملة. يرجى مراجعة مدير النظام.";
      httpStatus = 503;
    } else if (
      message.includes("فشل قراءة") ||
      message.includes("فشل الحصول") ||
      message.includes("UNAUTHENTICATED") ||
      message.includes("PERMISSION_DENIED") ||
      message.includes("404")
    ) {
      userMessage = "تعذر قراءة بيانات Google Sheets حالياً. تحقق من صلاحيات الحساب.";
      httpStatus = 502;
    } else if (message.includes("أعمدة مطلوبة مفقودة")) {
      userMessage = message;
      httpStatus = 400;
    } else if (message.includes("جاهز للشحن")) {
      userMessage = message;
      httpStatus = 500;
    }

    return NextResponse.json(
      {
        error: userMessage,
        ...(isDev && { debug: `${message}\n\n${stack ?? ""}`.trim() }),
      },
      { status: httpStatus }
    );
  }
}
