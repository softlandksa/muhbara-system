import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/order-number";
import { createNotificationsForRole } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";
import { deleteFile } from "@/lib/storage";

const receiptSchema = z.object({
  url: z.string().url("رابط الإيصال غير صحيح"),
  mimeType: z.string().min(1),
  size: z.number().int().min(0),
});

const createOrderSchema = z.object({
  orderDate: z.string().min(1, "التاريخ مطلوب"),
  customerName: z.string().min(1, "اسم العميل مطلوب"),
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  address: z.string().min(1, "العنوان مطلوب"),
  countryId: z.string().min(1, "الدولة مطلوبة"),
  currencyId: z.string().min(1, "العملة مطلوبة"),
  paymentMethodId: z.string().min(1, "طريقة الدفع مطلوبة"),
  notes: z.string().optional(),
  isRepeatCustomer: z.boolean().optional(),
  repeatCustomerNote: z.string().optional(),
  // Multi-receipt (new): up to 3 files, each already uploaded to Blob
  receipts: z.array(receiptSchema).max(3, "يمكن رفع 3 إيصالات كحد أقصى").optional(),
  // Legacy single-receipt fields (kept for backward compat)
  paymentReceiptUrl: z.string().url().optional(),
  paymentReceiptMime: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "المنتج مطلوب"),
        quantity: z.number().int().min(1, "الكمية يجب أن تكون 1 على الأقل"),
        lineTotal: z.number().min(0, "المبلغ لا يمكن أن يكون سالباً"),
      })
    )
    .min(1, "يجب إضافة منتج واحد على الأقل"),
});

const statusInclude = { select: { id: true, name: true, color: true, sortOrder: true } };

const orderInclude = {
  status: statusInclude,
  country: true,
  currency: true,
  paymentMethod: true,
  createdBy: { select: { id: true, name: true, email: true } },
  team: true,
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
    take: 3,
  },
  _count: { select: { items: true } },
};

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") ?? "25"));
  const search = searchParams.get("search") ?? "";
  const statusIds = searchParams.getAll("status");   // status param now holds IDs
  const countryIds = searchParams.getAll("countryId");
  const currencyId = searchParams.get("currencyId");
  const paymentMethodId = searchParams.get("paymentMethodId");
  const createdById = searchParams.get("createdById");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const { role, id: userId, teamId } = session.user;

  // Role-based base filter (no status restriction — all roles see all statuses)
  const roleFilter: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) roleFilter.teamId = teamId;
  if (role === "SALES" || role === "SUPPORT") roleFilter.createdById = userId;

  // User-applied filters
  const userFilter: Record<string, unknown> = {};
  if (statusIds.length > 0) userFilter.statusId = { in: statusIds };
  if (countryIds.length > 0) userFilter.countryId = { in: countryIds };
  if (currencyId) userFilter.currencyId = currencyId;
  if (paymentMethodId) userFilter.paymentMethodId = paymentMethodId;
  if (createdById && (role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER")) {
    userFilter.createdById = createdById;
  }
  const filterTeamId = searchParams.get("teamId");
  if ((role === "ADMIN" || role === "GENERAL_MANAGER") && filterTeamId) {
    roleFilter.teamId = filterTeamId;
  }
  if (dateFrom) userFilter.orderDate = { ...(userFilter.orderDate as object ?? {}), gte: new Date(dateFrom) };
  if (dateTo) userFilter.orderDate = { ...(userFilter.orderDate as object ?? {}), lte: new Date(dateTo + "T23:59:59") };

  const searchFilter = search
    ? {
        OR: [
          { orderNumber: { contains: search, mode: "insensitive" as const } },
          { customerName: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search } },
        ],
      }
    : {};

  const where = { AND: [roleFilter, userFilter, searchFilter] };

  const [total, data] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;
  if (role !== "ADMIN" && role !== "SALES" && role !== "SUPPORT") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
  }

  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 }
    );
  }

  const { orderDate, customerName, phone, address, countryId, currencyId, paymentMethodId, notes, isRepeatCustomer, repeatCustomerNote, receipts, paymentReceiptUrl, paymentReceiptMime, items } = parsed.data;

  // Parallel: validate country + look up initial status — independent queries.
  const [country, initialStatus] = await Promise.all([
    prisma.country.findUnique({ where: { id: countryId } }),
    prisma.shippingStatusPrimary.findFirst({ where: { name: "جاهز للشحن", isActive: true } }),
  ]);

  if (!country) return NextResponse.json({ error: "الدولة غير موجودة" }, { status: 400 });
  if (country.phoneFormat) {
    const regex = new RegExp(`^${country.phoneFormat.replace(/X/g, "\\d")}$`);
    if (!regex.test(phone)) {
      return NextResponse.json({ error: `صيغة رقم الهاتف غير صحيحة (${country.phoneFormat})` }, { status: 400 });
    }
  }
  if (!initialStatus) {
    return NextResponse.json({ error: "حالة 'جاهز للشحن' غير موجودة في الإعدادات" }, { status: 500 });
  }

  const totalAmount = items.reduce((sum, i) => sum + i.lineTotal, 0);

  try {
    // Keep only the data-integrity writes inside the transaction:
    // order create + audit log. Notifications and activity log are moved
    // outside so the advisory lock is held for the minimum possible time.
    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await generateOrderNumber(tx);
      const created = await tx.order.create({
        data: {
          orderNumber,
          orderDate: new Date(orderDate),
          customerName,
          phone,
          address,
          countryId,
          currencyId,
          paymentMethodId,
          statusId: initialStatus.id,
          totalAmount,
          notes: notes ?? null,
          isRepeatCustomer: isRepeatCustomer ?? false,
          repeatCustomerNote: repeatCustomerNote ?? null,
          paymentReceiptUrl: paymentReceiptUrl ?? null,
          paymentReceiptMime: paymentReceiptMime ?? null,
          paymentReceiptUploadedAt: paymentReceiptUrl ? new Date() : null,
          createdById: userId,
          teamId: teamId ?? null,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.quantity > 0 ? i.lineTotal / i.quantity : 0,
              totalPrice: i.lineTotal,
            })),
          },
        },
        include: { items: true, status: statusInclude },
      });

      await tx.orderAuditLog.create({
        data: {
          orderId: created.id,
          action: "CREATE",
          changedById: userId,
          changedAt: new Date(),
        },
      });

      // Create PaymentReceipt records for the multi-receipt system
      if (receipts && receipts.length > 0) {
        await tx.paymentReceipt.createMany({
          data: receipts.map((r) => ({
            orderId: created.id,
            url: r.url,
            mimeType: r.mimeType,
            size: r.size,
            uploadedById: userId,
          })),
        });
        await tx.orderAuditLog.create({
          data: {
            orderId: created.id,
            action: "RECEIPT_UPLOADED",
            changedById: userId,
            changedAt: new Date(),
          },
        });
      } else if (paymentReceiptUrl) {
        // Legacy single-receipt path
        await tx.orderAuditLog.create({
          data: {
            orderId: created.id,
            action: "RECEIPT_UPLOADED",
            changedById: userId,
            changedAt: new Date(),
          },
        });
      }

      return created;
    });

    // Post-transaction fire-and-forget: notifications + activity log.
    // These don't need to be atomic with the order create — if they fail,
    // the order is still saved and the user gets a success response.
    Promise.all([
      createNotificationsForRole(prisma, {
        role: "SHIPPING",
        title: "طلب جديد جاهز للشحن",
        message: `طلب رقم ${order.orderNumber} بواسطة ${session.user.name}`,
        type: "ORDER_STATUS",
        relatedOrderId: order.id,
      }),
      logActivity(prisma, {
        userId,
        action: "CREATE_ORDER",
        entityType: "Order",
        entityId: order.id,
        details: { orderNumber: order.orderNumber },
      }),
    ]).catch((err) => console.error("[POST /api/orders] post-commit side-effects error:", err));

    return NextResponse.json({ data: order }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/orders] transaction error:", err);
    // Clean up any blobs uploaded before the transaction failed to avoid orphans.
    const urlsToClean = [
      ...(receipts?.map((r) => r.url) ?? []),
      paymentReceiptUrl,
    ].filter((url): url is string => url != null && !url.startsWith("local://"));
    urlsToClean.forEach((url) =>
      deleteFile(url).catch((e) =>
        console.error("[POST /api/orders] orphan blob cleanup failed:", e)
      )
    );
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type BulkFilters = {
  search?: string;
  status?: string[];
  dateFrom?: string;
  dateTo?: string;
  createdById?: string;
  teamId?: string;
};

function buildBulkWhere(
  filters: BulkFilters,
  userRole: string,
  userId: string,
  userTeamId: string | null
) {
  const roleFilter: Record<string, unknown> = { deletedAt: null };
  if (userRole === "SALES_MANAGER" && userTeamId) roleFilter.teamId = userTeamId;
  if (userRole === "SALES" || userRole === "SUPPORT") roleFilter.createdById = userId;

  const userFilter: Record<string, unknown> = {};
  if (filters.status && filters.status.length > 0) userFilter.statusId = { in: filters.status };
  if (filters.createdById && (userRole === "ADMIN" || userRole === "GENERAL_MANAGER" || userRole === "SALES_MANAGER")) {
    userFilter.createdById = filters.createdById;
  }
  if (filters.teamId && (userRole === "ADMIN" || userRole === "GENERAL_MANAGER")) {
    roleFilter.teamId = filters.teamId;
  }
  if (filters.dateFrom) {
    userFilter.orderDate = { ...(userFilter.orderDate as object ?? {}), gte: new Date(filters.dateFrom) };
  }
  if (filters.dateTo) {
    userFilter.orderDate = { ...(userFilter.orderDate as object ?? {}), lte: new Date(filters.dateTo + "T23:59:59") };
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
  return { AND: [roleFilter, userFilter, searchFilter] };
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;

  let body: {
    action: "status" | "delete";
    scope?: "ids" | "all" | "limited";
    ids?: string[];
    limit?: number;
    filters?: BulkFilters;
    statusId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
  }

  const { action, scope = "ids", ids, limit, filters, statusId } = body;
  if (!action) return NextResponse.json({ error: "الإجراء مطلوب" }, { status: 400 });

  // Resolve the target order IDs depending on scope
  let targetIds: string[];

  if (scope === "all" || scope === "limited") {
    const where = buildBulkWhere(filters ?? {}, role, userId, teamId ?? null);
    const orders = await prisma.order.findMany({
      where,
      select: { id: true },
      ...(scope === "limited" && limit && limit > 0 ? { take: limit } : {}),
    });
    targetIds = orders.map((o) => o.id);
  } else {
    if (!ids || ids.length === 0) return NextResponse.json({ error: "لم يتم تحديد طلبات" }, { status: 400 });
    targetIds = ids;
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ data: { affected: 0 } });
  }

  if (action === "delete") {
    if (role !== "ADMIN") return NextResponse.json({ error: "ممنوع" }, { status: 403 });
    await prisma.order.updateMany({
      where: { id: { in: targetIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ data: { affected: targetIds.length } });
  }

  if (action === "status") {
    if (role !== "ADMIN" && role !== "SALES_MANAGER") return NextResponse.json({ error: "ممنوع" }, { status: 403 });
    if (!statusId) return NextResponse.json({ error: "الحالة مطلوبة" }, { status: 400 });
    const status = await prisma.shippingStatusPrimary.findUnique({ where: { id: statusId } });
    if (!status) return NextResponse.json({ error: "الحالة غير موجودة" }, { status: 400 });
    await prisma.order.updateMany({ where: { id: { in: targetIds }, deletedAt: null }, data: { statusId } });
    return NextResponse.json({ data: { affected: targetIds.length } });
  }

  return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 });
}
