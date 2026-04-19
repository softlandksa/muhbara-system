import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const upsertSchema = z.object({
  userId: z.string().min(1, "الموظف مطلوب"),
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
  targetOrders: z.number().int().min(1, "التارجت يجب أن يكون 1 على الأقل"),
});

// GET /api/targets?year=&month=
// Returns all active SALES/SALES_MANAGER employees with their target for the given month.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));

  const [employees, targets] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { in: ["SALES", "SALES_MANAGER"] } },
      select: {
        id: true,
        name: true,
        role: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.userTarget.findMany({ where: { year, month } }),
  ]);

  const targetMap = new Map(targets.map((t) => [t.userId, t]));
  const data = employees.map((emp) => ({
    ...emp,
    targetId: targetMap.get(emp.id)?.id ?? null,
    targetOrders: targetMap.get(emp.id)?.targetOrders ?? null,
  }));

  return NextResponse.json({ data });
}

// POST /api/targets  — upsert a single user's monthly target
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const { userId, year, month, targetOrders } = parsed.data;

  const target = await prisma.userTarget.upsert({
    where: { userId_year_month: { userId, year, month } },
    create: { userId, year, month, targetOrders },
    update: { targetOrders },
  });

  return NextResponse.json({ data: target }, { status: 201 });
}
