import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncShippingFromGoogleSheets } from "@/lib/google-sheets-shipping-sync";
import type { Role } from "@/types";

const ALLOWED_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER", "SHIPPING"];

function getMissingEnvVars(): string[] {
  const missing: string[] = [];
  const hasJson  = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const hasEmail = !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const hasKey   = !!process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!hasJson && !(hasEmail && hasKey)) {
    missing.push(!hasEmail && !hasKey ? "GOOGLE_SERVICE_ACCOUNT_JSON" : !hasEmail ? "GOOGLE_SHEETS_CLIENT_EMAIL" : "GOOGLE_SHEETS_PRIVATE_KEY");
  }
  if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID) missing.push("GOOGLE_SHEETS_SPREADSHEET_ID");
  return missing;
}

export async function POST() {
  const isDev = process.env.NODE_ENV !== "production";

  try {
    return await handlePost(isDev);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("SHIPPING_SYNC_UNHANDLED_ERROR", message);
    return NextResponse.json(
      { success: false, code: "INTERNAL_ERROR", error: `خطأ داخلي في الخادم: ${message}` },
      { status: 500 },
    );
  }
}

async function handlePost(isDev: boolean): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!ALLOWED_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  // ── Env check ─────────────────────────────────────────────────────────────
  const missing = getMissingEnvVars();
  if (missing.length > 0) {
    return NextResponse.json(
      { success: false, code: "MISSING_ENV_VARS", error: `إعدادات Google Sheets غير مكتملة: ${missing.join(", ")}` },
      { status: 503 },
    );
  }

  // ── Prevent concurrent shipping syncs ─────────────────────────────────────
  let running: { id: string; startedAt: Date } | null = null;
  try {
    running = await prisma.shippingSheetSyncRun.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    });
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return NextResponse.json(
      {
        success: false,
        code: "DB_SCHEMA_MISMATCH",
        error: "هيكل قاعدة البيانات غير متزامن — يرجى تشغيل: npx prisma db push",
        ...(isDev && { debug: msg }),
      },
      { status: 503 },
    );
  }

  if (running) {
    return NextResponse.json(
      { success: false, code: "ALREADY_RUNNING", error: "مزامنة الشحن قيد التشغيل بالفعل — يرجى الانتظار" },
      { status: 409 },
    );
  }

  // ── Run shipping sync ─────────────────────────────────────────────────────
  try {
    const result = await syncShippingFromGoogleSheets("MANUAL", userId);
    console.log(
      `SHIPPING_SYNC_COMPLETED rows:${result.totalRows} updated:${result.updatedCount} ` +
      `noChange:${result.noChangeCount} empty:${result.skippedEmptyCount} ` +
      `notFound:${result.notFoundCount} failed:${result.failedCount}`
    );
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const name    = err instanceof Error ? err.name    : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack   : undefined;

    console.error("SHIPPING_SYNC_ERROR", { name, message, stack });

    let code       = "SHIPPING_SYNC_ERROR";
    let userMsg    = message;
    let httpStatus = 500;

    if (message.includes("MISSING_CLIENT_EMAIL") || message.includes("غير مكتملة")) {
      code = "MISSING_ENV_VARS"; userMsg = "إعدادات Google Sheets غير مكتملة"; httpStatus = 503;
    } else if (message.includes("PRIVATE_KEY_FORMAT_ERROR")) {
      code = "PRIVATE_KEY_FORMAT_ERROR"; userMsg = "تنسيق مفتاح الخدمة غير صحيح"; httpStatus = 503;
    } else if (message.includes("PERMISSION_DENIED") || message.includes("403")) {
      code = "SHEET_PERMISSION_DENIED"; userMsg = "حساب الخدمة لا يملك صلاحية الوصول للجدول"; httpStatus = 502;
    } else if (message.includes("404") || message.includes("not found")) {
      code = "SPREADSHEET_NOT_FOUND"; userMsg = "معرّف جدول البيانات غير صحيح أو الجدول محذوف"; httpStatus = 502;
    } else if (message.includes("does not exist in the current database") || message.includes("P2022")) {
      code = "DB_SCHEMA_MISMATCH"; userMsg = "هيكل قاعدة البيانات غير متزامن — يرجى تشغيل: npx prisma db push"; httpStatus = 503;
    }

    return NextResponse.json(
      {
        success: false, code, error: userMsg,
        ...(isDev && { debug: `[${name}] ${message}\n\n${stack ?? ""}`.trim() }),
      },
      { status: httpStatus },
    );
  }
}
