import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOrderNumbers } from "@/lib/order-number";
import {
  IMPORT_COLUMNS,
  REQUIRED_IMPORT_HEADERS,
  IMPORT_SHEET_NAME,
  normaliseHeader,
  pickDataSheet,
} from "@/lib/import-columns";

function parseOrderDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  const str = String(raw).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  const serial = Number(str);
  if (!isNaN(serial) && serial > 1000 && serial < 2958466) {
    const d = new Date(new Date(1899, 11, 30).getTime() + serial * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export async function GET() {
  const headers = IMPORT_COLUMNS.map((c) => c.header);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, IMPORT_SHEET_NAME);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("نموذج_الطلبات_بسيط.xlsx")}`,
    },
  });
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Shape collected during validation pass (no DB writes yet)
type ValidatedRow = {
  id: string;                    // pre-generated UUID — used to link items without a second SELECT
  orderDate: Date;
  customerName: string;
  phone: string;
  address: string;
  countryId: string;
  currencyId: string;
  paymentMethodId: string;
  statusId: string;
  totalAmount: number;
  isRepeatCustomer: boolean;
  repeatCustomerNote: string | null;
  createdById: string;
  teamId: string | null;
  parsedOrderDate: Date | null;  // for audit newValue
  items: { productId: string; quantity: number; unitPrice: number; totalPrice: number }[];
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, id: userId, teamId } = session.user;
  if (role !== "ADMIN" && role !== "SALES_MANAGER" && role !== "SALES" && role !== "SUPPORT") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    console.error("[import] formData parse error:", e);
    return NextResponse.json(
      { error: "تعذّر قراءة الملف المرفوع — تأكد من إرسال multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file") as File | null;
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "لم يتم رفع ملف — تأكد من اختيار ملف Excel" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "الملف المرفوع فارغ" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "حجم الملف يتجاوز الحد المسموح به (10 ميجابايت)" },
      { status: 413 },
    );
  }

  let wb: XLSX.WorkBook;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    wb = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch (e) {
    console.error("[import] XLSX parse error:", e);
    return NextResponse.json(
      { error: "تعذّر قراءة الملف — تأكد من أن الملف بصيغة .xlsx أو .xls صحيحة" },
      { status: 400 },
    );
  }

  if (wb.SheetNames.length === 0) {
    return NextResponse.json({ error: "الملف لا يحتوي على أوراق عمل" }, { status: 400 });
  }

  const sheetName = pickDataSheet(wb.SheetNames, (name) => {
    const s = wb.Sheets[name];
    return s ? (XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1 }) as unknown[][]) : [];
  });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return NextResponse.json({ error: "الملف لا يحتوي على أوراق عمل" }, { status: 400 });
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

  let headerRowIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const cells = (rawRows[i] as unknown[]).map(normaliseHeader);
    const score = REQUIRED_IMPORT_HEADERS.filter((h) => cells.includes(h)).length;
    if (score > bestScore) { bestScore = score; headerRowIndex = i; }
  }

  const headerCells = (rawRows[headerRowIndex] as unknown[]).map(normaliseHeader);
  const missingHeaders = REQUIRED_IMPORT_HEADERS.filter((h) => !headerCells.includes(h));
  if (missingHeaders.length > 0) {
    const detected = headerCells.filter(Boolean).join("، ") || "(لا توجد رؤوس)";
    return NextResponse.json(
      {
        error:
          `الملف لا يحتوي على الأعمدة المطلوبة: ${missingHeaders.join("، ")}` +
          `\nالأعمدة المكتشفة في الملف: ${detected}`,
      },
      { status: 400 },
    );
  }

  const colMap: Record<string, number> = {};
  headerCells.forEach((h, idx) => { if (h) colMap[h] = idx; });

  const dataRawRows = rawRows.slice(headerRowIndex + 1);
  const rows: Record<string, unknown>[] = dataRawRows
    .map((rawRow) => {
      const obj: Record<string, unknown> = {};
      for (const [key, idx] of Object.entries(colMap)) {
        obj[key] = (rawRow as unknown[])[idx] ?? "";
      }
      return obj;
    })
    .filter((obj) => {
      if (!Object.values(obj).some((v) => String(v ?? "").trim() !== "")) return false;
      const HINT_RE = /\(مطلوب\)|مثال:|اختر من القائمة|رقم صحيح|سعر الوحدة/u;
      if (Object.values(obj).some((v) => HINT_RE.test(String(v ?? "")))) return false;
      return true;
    });

  if (rows.length === 0) {
    return NextResponse.json({ error: "الملف لا يحتوي على صفوف بيانات بعد رأس الأعمدة" }, { status: 400 });
  }

  // ── Fetch all reference data in parallel (one round-trip each) ───────────────
  const [countries, currencies, paymentMethods, products, activeUsers] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true } }),
    prisma.currency.findMany({ where: { isActive: true } }),
    prisma.paymentMethod.findMany({ where: { isActive: true } }),
    prisma.product.findMany({ where: { isActive: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, email: true, teamId: true } }),
  ]);
  const userByEmail = new Map(activeUsers.map((u) => [u.email.toLowerCase(), u]));

  // ── Batch duplicate-phone check (one query for all phones) ───────────────────
  const allPhones = rows
    .map((r) => String(r["الجوال"] ?? "").trim().replace(/^0+/, ""))
    .filter(Boolean);
  const existingByPhone: Record<string, number> = {};
  if (allPhones.length > 0) {
    const existing = await prisma.order.findMany({
      where: { phone: { in: allPhones }, deletedAt: null },
      select: { phone: true },
    });
    for (const o of existing) {
      existingByPhone[o.phone] = (existingByPhone[o.phone] ?? 0) + 1;
    }
  }

  // ── Look up initial status once ───────────────────────────────────────────────
  const initialStatus = await prisma.shippingStatusPrimary.findFirst({
    where: { name: "جاهز للشحن", isActive: true },
  });
  if (!initialStatus) {
    return NextResponse.json(
      { error: "حالة 'جاهز للشحن' غير موجودة في الإعدادات — يرجى مراجعة إعدادات حالات الشحن" },
      { status: 500 },
    );
  }

  // ── Phase 1: Validate ALL rows in memory — no DB writes ──────────────────────
  const validatedRows: ValidatedRow[] = [];
  const errors: { row: number; error: string }[] = [];
  const lc = (s: string) => s.trim().toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = headerRowIndex + 2 + i;

    try {
      const customerName = String(row["اسم العميل"] ?? "").trim();
      const phone        = String(row["الجوال"]     ?? "").trim().replace(/^0+/, "");
      const address      = String(row["العنوان"]    ?? "").trim();
      const countryName  = String(row["الدولة"]     ?? "").trim();
      const currencyCode = String(row["العملة"]     ?? "").trim();
      const paymentName  = String(row["طريقة الدفع"] ?? "").trim();
      const productName  = String(row["المنتج"]     ?? "").trim();
      const qty          = parseInt(String(row["الكمية"]  ?? "1"));
      const quantity     = isNaN(qty) || qty < 1 ? 1 : qty;
      const rawTotal     = parseFloat(String(row["السعر"] ?? "0"));
      const lineTotal    = isNaN(rawTotal) || rawTotal < 0 ? 0 : rawTotal;

      const rawOrderDate    = row["تاريخ الطلب"];
      const parsedOrderDate = parseOrderDate(rawOrderDate);
      if (rawOrderDate !== undefined && rawOrderDate !== "" && parsedOrderDate === null) {
        errors.push({
          row: rowNum,
          error: `تاريخ الطلب غير صالح: "${rawOrderDate}" — الصيغ المقبولة: YYYY-MM-DD أو DD/MM/YYYY أو رقم تاريخ Excel`,
        });
        continue;
      }
      const orderDate = parsedOrderDate ?? new Date();

      const employeeEmail = String(
        row["الموظف المسؤول (البريد الإلكتروني)"] ?? ""
      ).trim().toLowerCase();
      const isManager = (["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"] as string[]).includes(role);
      let responsibleUserId = userId;
      let responsibleTeamId = teamId ?? null;
      if (isManager && employeeEmail) {
        const assignedUser = userByEmail.get(employeeEmail);
        if (!assignedUser) {
          errors.push({ row: rowNum, error: `الموظف غير موجود أو غير نشط: ${employeeEmail}` });
          continue;
        }
        responsibleUserId = assignedUser.id;
        responsibleTeamId = assignedUser.teamId ?? null;
      }

      if (!customerName || !phone || !address || !countryName || !currencyCode || !paymentName || !productName) {
        errors.push({ row: rowNum, error: "بيانات ناقصة — تأكد من ملء جميع الأعمدة المطلوبة" });
        continue;
      }

      const country       = countries.find((c) => lc(c.name) === lc(countryName) || lc(c.code) === lc(countryName));
      const currency      = currencies.find((c) => lc(c.code) === lc(currencyCode) || lc(c.name) === lc(currencyCode));
      const paymentMethod = paymentMethods.find((p) => lc(p.name) === lc(paymentName));
      const product       = products.find((p) => lc(p.name) === lc(productName) || (p.sku != null && lc(p.sku) === lc(productName)));

      if (!country) {
        errors.push({ row: rowNum, error: `دولة غير موجودة: "${countryName}" — الدول المتاحة: ${countries.map((c) => c.name).join("، ")}` });
        continue;
      }
      if (!currency) {
        errors.push({ row: rowNum, error: `عملة غير موجودة: "${currencyCode}" — العملات المتاحة: ${currencies.map((c) => c.code).join("، ")}` });
        continue;
      }
      if (!paymentMethod) {
        errors.push({ row: rowNum, error: `طريقة دفع غير موجودة: "${paymentName}" — الطرق المتاحة: ${paymentMethods.map((p) => p.name).join("، ")}` });
        continue;
      }
      if (!product) {
        errors.push({ row: rowNum, error: `منتج غير موجود: "${productName}" — تأكد من اسم المنتج أو الكود` });
        continue;
      }

      const isDuplicate = (existingByPhone[phone] ?? 0) > 0;

      validatedRows.push({
        id: randomUUID(),
        orderDate,
        customerName,
        phone,
        address,
        countryId:       country.id,
        currencyId:      currency.id,
        paymentMethodId: paymentMethod.id,
        statusId:        initialStatus.id,
        totalAmount:     lineTotal,
        isRepeatCustomer: isDuplicate,
        repeatCustomerNote: isDuplicate
          ? `عميل مكرر — لديه ${existingByPhone[phone]} طلبات سابقة (استيراد)`
          : null,
        createdById: responsibleUserId,
        teamId:      responsibleTeamId,
        parsedOrderDate,
        items: [{
          productId:  product.id,
          quantity,
          unitPrice:  quantity > 0 ? lineTotal / quantity : 0,
          totalPrice: lineTotal,
        }],
      });
    } catch (e) {
      console.error(`[import] row ${rowNum} validation error:`, e);
      errors.push({ row: rowNum, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (validatedRows.length === 0) {
    return NextResponse.json({ data: { created: 0, repeatCustomers: 0, errors } });
  }

  // ── Phase 2: Batch insert — one transaction, one advisory lock ───────────────
  // The lock is held for the entire transaction to prevent duplicate order numbers
  // from a concurrent import or manual save.
  const now = new Date();
  try {
    await prisma.$transaction(
      async (tx) => {
        // Generate all order numbers at once (single lock + single count)
        const orderNumbers = await generateOrderNumbers(tx, validatedRows.length);

        // Batch insert orders
        await tx.order.createMany({
          data: validatedRows.map((o, i) => ({
            id:                 o.id,
            orderNumber:        orderNumbers[i],
            orderDate:          o.orderDate,
            customerName:       o.customerName,
            phone:              o.phone,
            address:            o.address,
            countryId:          o.countryId,
            currencyId:         o.currencyId,
            paymentMethodId:    o.paymentMethodId,
            statusId:           o.statusId,
            totalAmount:        o.totalAmount,
            isRepeatCustomer:   o.isRepeatCustomer,
            repeatCustomerNote: o.repeatCustomerNote,
            createdById:        o.createdById,
            teamId:             o.teamId,
          })),
        });

        // Batch insert items (orderId references the pre-generated UUID)
        await tx.orderItem.createMany({
          data: validatedRows.flatMap((o) =>
            o.items.map((item) => ({ orderId: o.id, ...item })),
          ),
        });

        // Batch insert audit logs
        await tx.orderAuditLog.createMany({
          data: validatedRows.map((o, i) => ({
            orderId:     o.id,
            action:      "IMPORT_ORDER",
            changedById: userId,
            changedAt:   now,
            newValue:    o.parsedOrderDate
              ? `تاريخ الطلب: ${o.orderDate.toISOString().slice(0, 10)}`
              : null,
            // Store the assigned order number for traceability
            fieldName: orderNumbers[i],
          })),
        });
      },
      { timeout: 60_000 }, // generous timeout for large files
    );
  } catch (err) {
    console.error("[import] batch insert error:", err);
    // Surface a single error covering the whole batch rather than N duplicate errors
    const message = err instanceof Error ? err.message : "خطأ في حفظ البيانات";
    return NextResponse.json(
      { data: { created: 0, repeatCustomers: 0, errors: [{ row: -1, error: `فشل إدراج الدفعة: ${message}` }] } },
    );
  }

  // ── Activity log — fire-and-forget, not on the critical path ─────────────────
  prisma.activityLog.createMany({
    data: validatedRows.map((o) => ({
      userId,
      action:     "IMPORT_ORDER",
      entityType: "Order",
      entityId:   o.id,
      details:    { orderDate: o.orderDate.toISOString().slice(0, 10), importedById: userId },
    })),
  }).catch((err) => console.error("[import] activity log batch error:", err));

  const repeatCount = validatedRows.filter((o) => o.isRepeatCustomer).length;
  return NextResponse.json({
    data: { created: validatedRows.length, repeatCustomers: repeatCount, errors },
  });
}
