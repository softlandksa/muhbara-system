import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const VALID_ROLES = [
  "ADMIN", "GENERAL_MANAGER", "SALES_MANAGER",
  "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR",
] as const;

const createUserSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  email: z.string().email("البريد الإلكتروني غير صالح"),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
  role: z.enum(VALID_ROLES, { error: "الدور غير صالح" }),
  teamId: z.string().optional().nullable(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "GENERAL_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      teamId: true,
      isActive: true,
      avatar: true,
      createdAt: true,
      updatedAt: true,
      team: {
        select: { id: true, name: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: users }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Zod validation failed:", parsed.error.issues);
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
        { status: 400 }
      );
    }

    const { name, email, password, role, teamId } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "البريد الإلكتروني مستخدم بالفعل" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash, role, teamId: teamId ?? null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        isActive: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        team: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: user }, { status: 201 });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("POST /api/users error:", errMsg);
    return NextResponse.json({ error: `حدث خطأ أثناء إنشاء الموظف: ${errMsg}` }, { status: 500 });
  }
}
