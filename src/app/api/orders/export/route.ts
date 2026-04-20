import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as XLSX from "xlsx";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

const ALLOWED_ROLES = ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

const MAX_IDS = 5_000;
const MAX_QUERY_ROWS = 50_000;

const filterSchema = z.object({
  search: z.string().optional(),
  status: z.array(z.string()).optional().default([]),
  countryId: z.array(z.string()).optional().default([]),
  currencyId: z.string().optional(),
  paymentMethodId: z.string().optional(),
  createdById: z.string().optional(),
  teamId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const exportSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ids"),
    orderIds: z.array(z.string()).min(1, "يجب تحديد طلب واحد على الأقل").max(MAX_IDS, `الحد الأقصى ${MAX_IDS} طلب`),
  }),
  z.object({
    mode: z.literal("query"),
    filters: filterSchema.optional(),
  }),
]);

const orderExportInclude = {
  status: { select: { name: true } },
  country: true,
  currency: true,
  paymentMethod: true,
  createdBy: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true } } } },
} as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;
  if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
  }

  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" }, { status: 400 });
  }

  // Role-based base filter — mirrors GET /api/orders exactly
  const roleFilter: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) roleFilter.teamId = teamId;
  if (role === "SALES") roleFilter.createdById = userId;

  let where: object;
  let exportCount: number;

  if (parsed.data.mode === "ids") {
    const { orderIds } = parsed.data;
    // Validate every requested ID is visible to this user
    const visible = await prisma.order.count({
      where: { AND: [roleFilter, { id: { in: orderIds } }] },
    });
    if (visible !== orderIds.length) {
      return NextResponse.json({ error: "بعض الطلبات المحددة غير مسموح بتصديرها" }, { status: 403 });
    }
    where = { AND: [roleFilter, { id: { in: orderIds } }] };
    exportCount = orderIds.length;
  } else {
    // mode "query" — rebuild WHERE identically to GET /api/orders
    const filters = parsed.data.filters ?? { status: [], countryId: [] };
    const userFilter: Record<string, unknown> = {};

    if (filters.status?.length) userFilter.statusId = { in: filters.status };
    if (filters.countryId?.length) userFilter.countryId = { in: filters.countryId };
    if (filters.currencyId) userFilter.currencyId = filters.currencyId;
    if (filters.paymentMethodId) userFilter.paymentMethodId = filters.paymentMethodId;
    if (filters.createdById && (role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER")) {
      userFilter.createdById = filters.createdById;
    }
    if ((role === "ADMIN" || role === "GENERAL_MANAGER") && filters.teamId) {
      roleFilter.teamId = filters.teamId;
    }
    if (filters.dateFrom) {
      userFilter.orderDate = { gte: new Date(filters.dateFrom) };
    }
    if (filters.dateTo) {
      userFilter.orderDate = {
        ...(userFilter.orderDate as object ?? {}),
        lte: new Date(filters.dateTo + "T23:59:59"),
      };
    }

    const searchFilter = filters.search
      ? {
          OR: [
            { orderNumber: { contains: filters.search, mode: "insensitive" as const } },
            { customerName: { contains: filters.search, mode: "insensitive" as const } },
            { phone: { contains: filters.search } },
          ],
        }
      : {};

    where = { AND: [roleFilter, userFilter, searchFilter] };
    exportCount = await prisma.order.count({ where });

    if (exportCount > MAX_QUERY_ROWS) {
      return NextResponse.json(
        {
          error: `عدد الطلبات المطابقة (${exportCount.toLocaleString("ar")}) يتجاوز الحد الأقصى (${MAX_QUERY_ROWS.toLocaleString("ar")}) — يرجى تضييق نطاق الفلاتر`,
        },
        { status: 400 }
      );
    }
  }

  const orders = await prisma.order.findMany({
    where,
    include: orderExportInclude,
    orderBy: { createdAt: "desc" },
  });

  console.log(
    `[EXPORT] user=${userId} role=${role} mode=${parsed.data.mode} count=${exportCount} time=${new Date().toISOString()}`
  );

  const rows = orders.map((o) => ({
    "رقم الطلب": o.orderNumber,
    "تاريخ الطلب": format(new Date(o.orderDate), "dd/MM/yyyy"),
    "تاريخ الإدخال": format(new Date(o.createdAt), "dd/MM/yyyy"),
    "اسم العميل": o.customerName,
    "الجوال": o.phone,
    "العنوان": o.address,
    "الدولة": o.country.name,
    "المنتجات": o.items.map((i) => `${i.product.name} (${i.quantity})`).join(" - "),
    "المبلغ الإجمالي": o.totalAmount,
    "العملة": o.currency.code,
    "طريقة الدفع": o.paymentMethod.name,
    "الحالة": o.status.name,
    "المنشئ": o.createdBy.name,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `طلبات_${format(new Date(), "yyyy-MM-dd")}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
