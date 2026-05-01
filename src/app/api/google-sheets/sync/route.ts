import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runGoogleSheetsImport } from "@/lib/google-sheets-import";
import type { Role } from "@/types";

const ALLOWED_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER", "SHIPPING"];

function isSheetsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
    process.env.GOOGLE_SHEETS_PRIVATE_KEY &&
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
    process.env.GOOGLE_SHEETS_SHEET_NAME
  );
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!ALLOWED_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  if (!isSheetsConfigured()) {
    return NextResponse.json(
      { error: "إعدادات Google Sheets غير مكتملة. يرجى مراجعة مدير النظام." },
      { status: 503 }
    );
  }

  // Prevent concurrent syncs
  const running = await prisma.googleSheetSyncRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (running) {
    return NextResponse.json(
      { error: "عملية المزامنة قيد التشغيل بالفعل — يرجى الانتظار" },
      { status: 409 }
    );
  }

  try {
    const result = await runGoogleSheetsImport("MANUAL", userId);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[POST /api/google-sheets/sync]", err);
    const message = err instanceof Error ? err.message : "";
    if (message.includes("إعدادات Google Sheets") || message.includes("GOOGLE_SHEETS")) {
      return NextResponse.json(
        { error: "إعدادات Google Sheets غير مكتملة. يرجى مراجعة مدير النظام." },
        { status: 503 }
      );
    }
    if (message.includes("فشل قراءة") || message.includes("فشل الحصول")) {
      return NextResponse.json(
        { error: "تعذر قراءة بيانات Google Sheets حالياً." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "حدث خطأ أثناء المزامنة. يرجى المحاولة مرة أخرى." },
      { status: 500 }
    );
  }
}
