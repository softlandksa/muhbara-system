import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("active") === "true";

  const countries = await prisma.country.findMany({
    where: {
      deletedAt: null,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: countries }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const body = await request.json();
  const { name, code, phoneCode, phoneFormat } = body;

  if (!name || !code) {
    return NextResponse.json(
      { error: "الاسم والرمز مطلوبان" },
      { status: 400 }
    );
  }

  if (!/^[A-Z]{2}$/.test(code)) {
    return NextResponse.json(
      { error: "يجب أن يكون الرمز حرفين كبيرين باللغة الإنجليزية" },
      { status: 400 }
    );
  }

  const existing = await prisma.country.findFirst({
    where: { OR: [{ name }, { code }], deletedAt: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: "الاسم أو الرمز مستخدم بالفعل" },
      { status: 409 }
    );
  }

  const country = await prisma.country.create({
    data: { name, code, phoneCode, phoneFormat },
  });

  return NextResponse.json({ data: country }, { status: 201 });
}
