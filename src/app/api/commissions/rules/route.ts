import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// NaN (from empty number inputs + valueAsNumber:true) is serialized to null by JSON.stringify,
// but defend on the server too with a preprocess.
// Commission-eligible role types — must match calculate/route.ts COMMISSION_ROLES.
// SALES: orders created by employee; SHIPPING: orders shipped by employee;
// FOLLOWUP: orders employee added follow-up notes on;
// SALES_MANAGER: all orders in manager's team; GENERAL_MANAGER: all orders system-wide.
const COMMISSION_ROLE_TYPES = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"] as const;

const ruleSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  roleType: z.enum(COMMISSION_ROLE_TYPES),
  minOrders: z.preprocess(
    (v) => (typeof v === "number" && isNaN(v)) ? 0 : v,
    z.number().int().min(0),
  ),
  maxOrders: z.preprocess(
    (v) => (typeof v === "number" && isNaN(v)) ? null : v,
    z.number().int().min(0).nullable().optional(),
  ),
  commissionAmount: z.preprocess(
    (v) => (typeof v === "number" && isNaN(v)) ? 0 : v,
    z.number().min(0),
  ),
  commissionType: z.enum(["FIXED", "PERCENTAGE"]),
  currencyId: z.string().min(1, "العملة مطلوبة"),
});

// Prisma error code → Arabic message
function prismaErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    switch ((e as { code: string }).code) {
      case "P2003": return "العملة المحددة غير موجودة أو غير صحيحة";
      case "P2002": return "يوجد تعارض في البيانات — تحقق من عدم تكرار الشريحة";
      case "P2025": return "السجل المطلوب غير موجود";
      default: break;
    }
  }
  return "خطأ في قاعدة البيانات — حاول مجدداً";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  try {
    const rules = await prisma.commissionRule.findMany({
      include: { currency: { select: { id: true, code: true, symbol: true } } },
      orderBy: [{ roleType: "asc" }, { minOrders: "asc" }],
    });
    return NextResponse.json({ data: rules });
  } catch (e) {
    console.error("[commissions/rules GET]", e);
    return NextResponse.json({ error: "فشل تحميل القواعد" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صالحة" }, { status: 400 });
  }

  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "بيانات غير صحيحة";
    console.error("[commissions/rules POST] validation:", parsed.error.issues);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { roleType, minOrders, maxOrders, currencyId } = parsed.data;

  try {
    // Verify currency exists first — gives a clear error if not found
    const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) {
      return NextResponse.json({ error: "العملة المحددة غير موجودة" }, { status: 400 });
    }

    // Enforce non-overlapping ranges per (roleType, currencyId).
    // Two ranges [A,B] and [C,D] overlap iff: A <= D AND C <= B  (null = ∞).
    const andConditions: object[] = [
      {
        OR: [
          { maxOrders: null },
          { maxOrders: { gte: minOrders } },
        ],
      },
    ];
    if (maxOrders != null) {
      andConditions.push({ minOrders: { lte: maxOrders } });
    }

    const overlap = await prisma.commissionRule.findFirst({
      where: { roleType, currencyId, isActive: true, AND: andConditions },
    });
    if (overlap) {
      return NextResponse.json(
        {
          error: `يتداخل النطاق مع قاعدة موجودة: "${overlap.name}" (${overlap.minOrders}–${overlap.maxOrders ?? "∞"})`,
        },
        { status: 400 },
      );
    }

    const rule = await prisma.commissionRule.create({
      data: {
        name: parsed.data.name,
        roleType: parsed.data.roleType,
        minOrders: parsed.data.minOrders,
        maxOrders: parsed.data.maxOrders ?? null,
        commissionAmount: parsed.data.commissionAmount,
        commissionType: parsed.data.commissionType,
        currency: { connect: { id: currencyId } },
      },
      include: { currency: { select: { id: true, code: true, symbol: true } } },
    });

    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (e) {
    console.error("[commissions/rules POST] prisma:", e);
    return NextResponse.json({ error: prismaErrorMessage(e) }, { status: 500 });
  }
}
