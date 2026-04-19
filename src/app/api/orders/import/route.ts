import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/order-number";
import { logActivity } from "@/lib/activity-log";
import {
  IMPORT_COLUMNS,
  REQUIRED_IMPORT_HEADERS,
  IMPORT_SHEET_NAME,
  normaliseHeader,
  pickDataSheet,
} from "@/lib/import-columns";

// ── Fallback minimal template (no DB calls, no reference sheets) ──────────────
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

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

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
      { status: 400 }
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
      { status: 413 }
    );
  }

  let wb: XLSX.WorkBook;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    wb = XLSX.read(bytes, { type: "array" });
  } catch (e) {
    console.error("[import] XLSX parse error:", e);
    return NextResponse.json(
      { error: "تعذّر قراءة الملف — تأكد من أن الملف بصيغة .xlsx أو .xls صحيحة" },
      { status: 400 }
    );
  }

  if (wb.SheetNames.length === 0) {
    return NextResponse.json({ error: "الملف لا يحتوي على أوراق عمل" }, { status: 400 });
  }

  // ── Pick correct sheet: prefer "الطلبات", fall back to best header match ──────
  const sheetName = pickDataSheet(wb.SheetNames, (name) => {
    const s = wb.Sheets[name];
    return s ? (XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1 }) as unknown[][]) : [];
  });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return NextResponse.json({ error: "الملف لا يحتوي على أوراق عمل" }, { status: 400 });
  }

  // ── Read all rows as arrays, find header row (first N rows scanned) ───────────
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

  // Scan first 10 rows for the one with the most required-header matches
  let headerRowIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const cells = (rawRows[i] as unknown[]).map(normaliseHeader);
    const score = REQUIRED_IMPORT_HEADERS.filter((h) => cells.includes(h)).length;
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = i;
    }
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
      { status: 400 }
    );
  }

  // Re-parse using the detected header row as column names
  // sheet_to_json with { header: detected_row + 1 } skips the header row itself
  // We do this manually: build a column index map then read data rows
  const colMap: Record<string, number> = {};
  headerCells.forEach((h, idx) => { if (h) colMap[h] = idx; });

  const dataRawRows = rawRows.slice(headerRowIndex + 1);
  // Map each raw array row to a named object, skip fully-empty rows
  const rows: Record<string, unknown>[] = dataRawRows
    .map((rawRow) => {
      const obj: Record<string, unknown> = {};
      for (const [key, idx] of Object.entries(colMap)) {
        obj[key] = (rawRow as unknown[])[idx] ?? "";
      }
      return obj;
    })
    .filter((obj) => {
      // Skip blank rows
      if (!Object.values(obj).some((v) => String(v ?? "").trim() !== "")) return false;
      // Skip instruction/hint rows left over from older templates
      const HINT_RE = /\(مطلوب\)|مثال:|اختر من القائمة|رقم صحيح|سعر الوحدة/u;
      if (Object.values(obj).some((v) => HINT_RE.test(String(v ?? "")))) return false;
      return true;
    });

  if (rows.length === 0) {
    return NextResponse.json({ error: "الملف لا يحتوي على صفوف بيانات بعد رأس الأعمدة" }, { status: 400 });
  }

  // ── Fetch reference data ──────────────────────────────────────────────────────
  const [countries, currencies, paymentMethods, products, activeUsers] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true } }),
    prisma.currency.findMany({ where: { isActive: true } }),
    prisma.paymentMethod.findMany({ where: { isActive: true } }),
    prisma.product.findMany({ where: { isActive: true } }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, teamId: true },
    }),
  ]);
  const userByEmail = new Map(activeUsers.map((u) => [u.email.toLowerCase(), u]));

  // ── Batch duplicate-phone check ───────────────────────────────────────────────
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

  // ── Look up initial status ONCE — fail fast if missing ───────────────────────
  const initialStatus = await prisma.shippingStatusPrimary.findFirst({
    where: { name: "جاهز للشحن", isActive: true },
  });
  if (!initialStatus) {
    return NextResponse.json(
      {
        error:
          "حالة 'جاهز للشحن' غير موجودة في الإعدادات — يرجى مراجعة إعدادات حالات الشحن",
      },
      { status: 500 }
    );
  }

  const created: string[] = [];
  const errors: { row: number; error: string }[] = [];
  let repeatCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Row number shown to user: headerRowIndex (0-based) + 1 (header itself) + 1 (Excel 1-based) + i
    const rowNum = headerRowIndex + 2 + i;

    try {
      const customerName = String(row["اسم العميل"] ?? "").trim();
      const phone        = String(row["الجوال"]     ?? "").trim().replace(/^0+/, "");
      const address      = String(row["العنوان"]    ?? "").trim();
      const countryName  = String(row["الدولة"]     ?? "").trim();
      const currencyCode = String(row["العملة"]     ?? "").trim();
      const paymentName  = String(row["طريقة الدفع"] ?? "").trim();
      const productName  = String(row["المنتج"]     ?? "").trim();
      const qty         = parseInt(String(row["الكمية"]  ?? "1"));
      const quantity    = isNaN(qty) || qty < 1 ? 1 : qty;
      const rawTotal    = parseFloat(String(row["السعر"] ?? "0"));
      const lineTotal   = isNaN(rawTotal) || rawTotal < 0 ? 0 : rawTotal;

      const employeeEmail = String(
        row["الموظف المسؤول (البريد الإلكتروني)"] ?? ""
      ).trim().toLowerCase();
      const isManager = (
        ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"] as string[]
      ).includes(role);
      let responsibleUserId  = userId;
      let responsibleTeamId  = teamId ?? null;
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

      // Case-insensitive reference lookups
      const lc = (s: string) => s.trim().toLowerCase();
      const country       = countries.find(
        (c) => lc(c.name) === lc(countryName) || lc(c.code) === lc(countryName)
      );
      const currency      = currencies.find(
        (c) => lc(c.code) === lc(currencyCode) || lc(c.name) === lc(currencyCode)
      );
      const paymentMethod = paymentMethods.find((p) => lc(p.name) === lc(paymentName));
      const product       = products.find(
        (p) =>
          lc(p.name) === lc(productName) ||
          (p.sku != null && lc(p.sku) === lc(productName))
      );

      if (!country) {
        errors.push({
          row: rowNum,
          error: `دولة غير موجودة: "${countryName}" — الدول المتاحة: ${countries.map((c) => c.name).join("، ")}`,
        });
        continue;
      }
      if (!currency) {
        errors.push({
          row: rowNum,
          error: `عملة غير موجودة: "${currencyCode}" — العملات المتاحة: ${currencies.map((c) => c.code).join("، ")}`,
        });
        continue;
      }
      if (!paymentMethod) {
        errors.push({
          row: rowNum,
          error: `طريقة دفع غير موجودة: "${paymentName}" — الطرق المتاحة: ${paymentMethods.map((p) => p.name).join("، ")}`,
        });
        continue;
      }
      if (!product) {
        errors.push({
          row: rowNum,
          error: `منتج غير موجود: "${productName}" — تأكد من اسم المنتج أو الكود`,
        });
        continue;
      }

      const isDuplicate = (existingByPhone[phone] ?? 0) > 0;
      if (isDuplicate) repeatCount++;

      const order = await prisma.$transaction(async (tx) => {
        const orderNumber = await generateOrderNumber(tx);
        const o = await tx.order.create({
          data: {
            orderNumber,
            orderDate: new Date(),
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
            items: {
              create: [
                {
                  productId:  product.id,
                  quantity,
                  unitPrice:  quantity > 0 ? lineTotal / quantity : 0,
                  totalPrice: lineTotal,
                },
              ],
            },
          },
        });
        await tx.orderAuditLog.create({
          data: { orderId: o.id, action: "CREATE", changedById: userId, changedAt: new Date() },
        });
        await logActivity(tx, {
          userId,
          action:     "IMPORT_ORDER",
          entityType: "Order",
          entityId:   o.id,
        });
        return o;
      });

      created.push(order.orderNumber);
    } catch (e) {
      console.error(`[import] row ${rowNum} error:`, e);
      errors.push({ row: rowNum, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    data: { created: created.length, repeatCustomers: repeatCount, errors },
  });
}
