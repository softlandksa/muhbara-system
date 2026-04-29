import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isStorageReady } from "@/lib/storage";

type CheckResult = { ok: boolean; detail: string };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const checks: Record<string, CheckResult> = {};

  // Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, detail: "connected" };
  } catch (err) {
    checks.database = {
      ok: false,
      detail: err instanceof Error ? err.message : "connection failed",
    };
  }

  // Vercel Blob storage
  const storageReady = isStorageReady();
  checks.storage = {
    ok: storageReady,
    detail: storageReady
      ? "BLOB_READ_WRITE_TOKEN is set"
      : "BLOB_READ_WRITE_TOKEN is missing — file uploads will fail in production",
  };

  // Required environment variables (non-sensitive presence check only)
  const required = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];
  const missing = required.filter((v) => !process.env[v]);
  checks.environment = {
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? "all required variables present"
        : `missing: ${missing.join(", ")}`,
  };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks },
    { status: allOk ? 200 : 503 }
  );
}
