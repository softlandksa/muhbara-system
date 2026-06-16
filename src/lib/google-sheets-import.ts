import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/order-number";
import { listSheets, readSheetByName, writeSheetResults } from "@/lib/google-sheets";
import { parseSheetOrderDate } from "@/lib/date-format";

// ─── Column header names (must match the sheet header row exactly) ─────────────

const H_EXTERNAL_ID     = "External Order ID";
const H_SYSTEM_ORDER_ID = "System Order ID";
const H_ORDER_DATE      = "Order Date";
const H_CUSTOMER_NAME   = "Customer Name";
const H_PHONE           = "Phone";
const H_COUNTRY         = "Country";
const H_CITY            = "City";
const H_ADDRESS         = "Detailed Address";
const H_PRODUCT         = "Product";
const H_QUANTITY        = "Quantity";
const H_PAID_AMOUNT     = "Paid Amount";
const H_CURRENCY        = "Currency";
const H_PAYMENT_METHOD  = "Payment Method";
const H_RECEIPT_1       = "Receipt URL 1";
const H_RECEIPT_2       = "Receipt URL 2";
const H_RECEIPT_3       = "Receipt URL 3";
const H_NOTES           = "Notes";
const H_EMPLOYEE_EMAIL  = "Employee Email";
const H_SYNC_STATUS     = "Sync Status";
const H_ERROR_MESSAGE   = "Error Message";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncMode = "update" | "resync";

export type SyncResult = {
  syncRunId: string;
  mode: SyncMode;
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  noChangeCount: number;
  skippedEmptyCount: number;
  duplicateCount: number;
  failedCount: number;
  deletedCount: number;
  startedAt: Date;
  finishedAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type HeaderMap = Record<string, number>;

type WriteBack = {
  rowIndex: number;
  syncStatus: string;
  systemOrderId: string;
  errorMessage: string;
};

type ExistingOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  countryId: string;
  currencyId: string;
  paymentMethodId: string;
  totalAmount: number;
  notes: string | null;
  orderDate: Date;
  createdById: string;
  teamId: string | null;
  items: { productId: string; quantity: number; unitPrice: number }[];
};

function getCell(values: string[], map: HeaderMap, col: string): string {
  const idx = map[col];
  return idx !== undefined ? (values[idx] ?? "").trim() : "";
}

function lc(s: string): string {
  return s.trim().toLowerCase();
}

/** Strips all non-digit chars then leading zeros for phone comparison. */
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "");
}

function isValidHttpUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function guessMime(url: string): string {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".pdf"))  return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png"))  return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

/** Returns true when none of the four key identifier fields contain any data. */
function isRowEmpty(values: string[], map: HeaderMap): boolean {
  return (
    !getCell(values, map, H_EXTERNAL_ID) &&
    !getCell(values, map, H_CUSTOMER_NAME) &&
    !getCell(values, map, H_PHONE) &&
    !getCell(values, map, H_PRODUCT)
  );
}

/**
 * Compares the relevant sheet-derived values against the existing order.
 * Returns true if any field differs (i.e. an update is needed).
 */
function hasOrderChanged(
  existing: ExistingOrder,
  next: {
    customerName: string;
    phone: string;
    address: string;
    countryId: string;
    currencyId: string;
    paymentMethodId: string;
    totalAmount: number;
    notes: string | null;
    orderDate: Date;
    productId: string;
    quantity: number;
  },
): boolean {
  const item = existing.items[0];
  return (
    existing.customerName    !== next.customerName   ||
    existing.phone           !== next.phone          ||
    existing.address         !== next.address        ||
    existing.countryId       !== next.countryId      ||
    existing.currencyId      !== next.currencyId     ||
    existing.paymentMethodId !== next.paymentMethodId ||
    Math.abs(existing.totalAmount - next.totalAmount) > 0.001 ||
    (existing.notes ?? null) !== (next.notes ?? null) ||
    existing.orderDate.getTime() !== next.orderDate.getTime() ||
    item?.productId !== next.productId ||
    item?.quantity  !== next.quantity
  );
}

const ORDER_SELECT = {
  id: true, orderNumber: true, customerName: true, phone: true,
  address: true, countryId: true, currencyId: true, paymentMethodId: true,
  totalAmount: true, notes: true, orderDate: true, createdById: true, teamId: true,
  items: { select: { productId: true, quantity: true, unitPrice: true } },
} as const;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Scans every sheet/tab in the configured spreadsheet and imports / updates orders.
 *
 * mode "update"  — safe daily mode: only creates new orders, never touches existing ones.
 * mode "resync"  — admin-only: creates new + updates changed + hard-deletes orders
 *                  whose externalOrderId is no longer present in any sheet.
 *
 * Row priority per mode:
 *   "update":
 *     1. Skip empty rows silently
 *     2. Skip already-"Synced" rows (the order already exists)
 *     3. Validate required fields
 *     4. Existing order found → No Change (write back, count as noChange)
 *     5. Duplicate phone → Duplicate
 *     6. Otherwise → Create new order → Synced
 *
 *   "resync":
 *     1. Skip empty rows silently
 *     2. Process ALL rows (including previously-Synced)
 *     3. Validate required fields
 *     4. Existing order found + changed → Update (never changes status)
 *     5. Existing order found + same → No Change
 *     6. Not found + duplicate phone → Duplicate
 *     7. Not found + no duplicate → Create new order → Synced
 *     8. After all sheets: hard-delete orders (source=GOOGLE_SHEETS) whose
 *        externalOrderId was NOT seen in any sheet.
 */
export async function runGoogleSheetsImport(
  triggeredBy: "MANUAL" | "CRON",
  mode: SyncMode,
  triggeredByUserId?: string,
): Promise<SyncResult> {
  const startedAt = new Date();

  const syncRun = await prisma.googleSheetSyncRun.create({
    data: {
      startedAt, triggeredBy, mode,
      triggeredByUserId: triggeredByUserId ?? null,
      status: "RUNNING",
    },
  });

  let totalSheets       = 0;
  let sheetsSkipped     = 0;
  let totalRows         = 0;
  let importedCount     = 0;
  let updatedCount      = 0;
  let noChangeCount     = 0;
  let skippedEmptyCount = 0;
  let duplicateCount    = 0;
  let failedCount       = 0;
  let deletedCount      = 0;

  // All external IDs seen across every sheet — used for resync delete phase.
  const allSeenExternalIds = new Set<string>();

  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID غير مكوّن");

    console.log(`[GoogleSheetsImport] starting ${triggeredBy} sync (mode: ${mode}, run id: ${syncRun.id})`);

    // ── 1. Discover all sheets ──────────────────────────────────────────────
    const sheetNames = await listSheets(spreadsheetId);
    totalSheets = sheetNames.length;
    console.log(`[GoogleSheetsImport] ${totalSheets} sheet(s): ${sheetNames.join(", ")}`);

    if (totalSheets === 0) {
      const finishedAt = new Date();
      await prisma.googleSheetSyncRun.update({
        where: { id: syncRun.id },
        data: { status: "COMPLETED", finishedAt, totalSheets: 0, mode },
      });
      return {
        syncRunId: syncRun.id, mode,
        totalSheets: 0, sheetsSkipped: 0, totalRows: 0,
        importedCount: 0, updatedCount: 0, noChangeCount: 0,
        skippedEmptyCount: 0, duplicateCount: 0, failedCount: 0, deletedCount: 0,
        startedAt, finishedAt,
      };
    }

    // ── 2. Load shared DB lookup data ──────────────────────────────────────
    const [
      countries, currencies, paymentMethods, products,
      employees, initialStatus, existingLogs, existingOrders,
    ] = await Promise.all([
      prisma.country.findMany({ where: { deletedAt: null } }),
      prisma.currency.findMany({ where: { deletedAt: null } }),
      prisma.paymentMethod.findMany({ where: { deletedAt: null } }),
      prisma.product.findMany({ where: { deletedAt: null, isActive: true } }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, email: true, name: true, teamId: true },
      }),
      prisma.shippingStatusPrimary.findFirst({
        where: { name: "جاهز للشحن", isActive: true },
      }),
      prisma.googleSheetImportLog.findMany({
        where: { spreadsheetId },
        select: { externalOrderId: true, status: true, systemOrderId: true },
      }),
      // Active (visible) orders only — soft-deleted orders must not block re-import
      prisma.order.findMany({
        where: { deletedAt: null },
        select: { phone: true },
      }),
    ]);

    if (!initialStatus) throw new Error("حالة 'جاهز للشحن' غير موجودة في إعدادات النظام");

    console.log("SYNC_VISIBLE_ORDERS_COUNT", { visibleOrders: existingOrders.length });

    const countryByName  = new Map(countries.map((c) => [lc(c.name), c]));
    const countryByCode  = new Map(countries.map((c) => [lc(c.code), c]));
    const currencyByName = new Map(currencies.map((c) => [lc(c.name), c]));
    const currencyByCode = new Map(currencies.map((c) => [lc(c.code), c]));
    const pmByName       = new Map(paymentMethods.map((p) => [lc(p.name), p]));
    const productByName  = new Map(products.map((p) => [lc(p.name), p]));
    const productBySku   = new Map(
      products.filter((p) => p.sku).map((p) => [lc(p.sku!), p])
    );
    const employeeByEmail       = new Map(employees.map((e) => [lc(e.email), e]));
    const importLogByExternalId = new Map(existingLogs.map((l) => [l.externalOrderId, l]));

    const existingPhones = new Set(
      existingOrders.map((o) => normalizePhone(o.phone)).filter(Boolean)
    );

    const activityQueue: Array<{ userId: string; orderId: string; orderNumber: string }> = [];

    // ── 3. Loop through every sheet ────────────────────────────────────────
    for (const sheetName of sheetNames) {
      console.log(`[GoogleSheetsImport] processing sheet: ${sheetName}`);

      try {
        const { headers, rows } = await readSheetByName(spreadsheetId, sheetName);

        if (headers.length === 0) {
          sheetsSkipped++;
          console.log(`[GoogleSheetsImport] sheet "${sheetName}" skipped — no header`);
          continue;
        }

        const headerMap: HeaderMap = {};
        headers.forEach((h, i) => { if (h) headerMap[h] = i; });

        const syncStatusColIdx    = headerMap[H_SYNC_STATUS];
        const systemOrderIdColIdx = headerMap[H_SYSTEM_ORDER_ID];
        const errorMessageColIdx  = headerMap[H_ERROR_MESSAGE];

        if (syncStatusColIdx === undefined || systemOrderIdColIdx === undefined || errorMessageColIdx === undefined) {
          sheetsSkipped++;
          const missing = [
            syncStatusColIdx    === undefined ? H_SYNC_STATUS     : null,
            systemOrderIdColIdx === undefined ? H_SYSTEM_ORDER_ID : null,
            errorMessageColIdx  === undefined ? H_ERROR_MESSAGE   : null,
          ].filter(Boolean).join(", ");
          console.log(`[GoogleSheetsImport] sheet "${sheetName}" skipped — missing: ${missing}`);
          continue;
        }

        if (rows.length === 0) {
          console.log(`[GoogleSheetsImport] sheet "${sheetName}" — no data rows`);
          continue;
        }

        // ── Collect ALL external IDs from every row (for resync delete phase) ─
        for (const row of rows) {
          const extId = getCell(row.values, headerMap, H_EXTERNAL_ID);
          if (extId) allSeenExternalIds.add(extId);
        }

        // ── Candidate filtering ────────────────────────────────────────────
        // "update" mode: skip already-Synced rows (they already exist).
        // "resync" mode: re-evaluate all rows including Synced ones.
        const candidateRows = mode === "resync"
          ? rows
          : rows.filter((r) => lc(getCell(r.values, headerMap, H_SYNC_STATUS)) !== "synced");

        totalRows += candidateRows.length;

        console.log(
          `[GoogleSheetsImport] sheet "${sheetName}" (${mode}) — ` +
          `total: ${rows.length}, candidates: ${candidateRows.length}, ` +
          `skipped-synced: ${rows.length - candidateRows.length}`
        );

        const sheetWriteBacks: WriteBack[] = [];

        for (const row of candidateRows) {
          const { rowIndex, values } = row;
          console.log("GOOGLE_SYNC_ROW_NUMBER", { sheet: sheetName, rowIndex, mode });

          // ── A. Skip truly empty rows — no write-back at all ───────────
          if (isRowEmpty(values, headerMap)) {
            console.log("GOOGLE_SYNC_EMPTY_ROW_SKIPPED", { sheet: sheetName, rowIndex });
            skippedEmptyCount++;
            continue;
          }

          const externalOrderId      = getCell(values, headerMap, H_EXTERNAL_ID);
          const systemOrderIdInSheet = getCell(values, headerMap, H_SYSTEM_ORDER_ID);

          // ── B. Validate ────────────────────────────────────────────────
          const errs: string[] = [];

          const orderDateRaw = getCell(values, headerMap, H_ORDER_DATE);
          const orderDate    = orderDateRaw ? parseSheetOrderDate(orderDateRaw) : null;
          if (!orderDateRaw || !orderDate) errs.push("تاريخ الطلب غير صالح");

          const customerName = getCell(values, headerMap, H_CUSTOMER_NAME);
          if (!customerName) errs.push("Customer Name مطلوب");

          const phone = getCell(values, headerMap, H_PHONE);
          if (!phone) errs.push("Phone مطلوب");

          const countryName = getCell(values, headerMap, H_COUNTRY);
          const country = countryByName.get(lc(countryName)) ?? countryByCode.get(lc(countryName));
          if (!countryName)  errs.push("Country مطلوب");
          else if (!country) errs.push(`الدولة غير موجودة: ${countryName}`);

          const productName = getCell(values, headerMap, H_PRODUCT);
          const product = productByName.get(lc(productName)) ?? productBySku.get(lc(productName));
          if (!productName)  errs.push("Product مطلوب");
          else if (!product) errs.push(`المنتج غير موجود: ${productName}`);

          const quantityRaw = getCell(values, headerMap, H_QUANTITY);
          const quantity    = parseInt(quantityRaw, 10);
          if (!quantityRaw)                         errs.push("Quantity مطلوب");
          else if (isNaN(quantity) || quantity < 1) errs.push(`كمية غير صحيحة: ${quantityRaw}`);

          const paidAmountRaw = getCell(values, headerMap, H_PAID_AMOUNT);
          const paidAmount    = parseFloat(paidAmountRaw);
          if (!paidAmountRaw)                          errs.push("Paid Amount مطلوب");
          else if (isNaN(paidAmount) || paidAmount < 0) errs.push(`مبلغ غير صحيح: ${paidAmountRaw}`);

          const currencyName = getCell(values, headerMap, H_CURRENCY);
          const currency = currencyByName.get(lc(currencyName)) ?? currencyByCode.get(lc(currencyName));
          if (!currencyName)  errs.push("Currency مطلوب");
          else if (!currency) errs.push(`العملة غير موجودة: ${currencyName}`);

          const pmName        = getCell(values, headerMap, H_PAYMENT_METHOD);
          const paymentMethod = pmByName.get(lc(pmName));
          if (!pmName)             errs.push("Payment Method مطلوب");
          else if (!paymentMethod) errs.push(`طريقة الدفع غير موجودة: ${pmName}`);

          const employeeEmail = getCell(values, headerMap, H_EMPLOYEE_EMAIL);
          const employee      = employeeByEmail.get(lc(employeeEmail));
          if (!employeeEmail) errs.push("Employee Email مطلوب");
          else if (!employee) errs.push(`الموظف غير موجود: ${employeeEmail}`);

          const receiptUrls = [
            getCell(values, headerMap, H_RECEIPT_1),
            getCell(values, headerMap, H_RECEIPT_2),
            getCell(values, headerMap, H_RECEIPT_3),
          ].filter(Boolean);
          for (const url of receiptUrls) {
            if (!isValidHttpUrl(url)) errs.push(`رابط إيصال غير صحيح: ${url.substring(0, 80)}`);
          }

          if (errs.length > 0) {
            const errorMessage = errs.join(" | ");
            console.warn("GOOGLE_SYNC_ROW_NUMBER", { valid: false, sheet: sheetName, rowIndex, errors: errorMessage });
            failedCount++;
            sheetWriteBacks.push({ rowIndex, syncStatus: "Failed", systemOrderId: "", errorMessage });
            if (externalOrderId) {
              prisma.googleSheetImportLog.upsert({
                where: { externalOrderId },
                create: { externalOrderId, spreadsheetId, sheetName, rowNumber: rowIndex, status: "FAILED", errorMessage },
                update: { rowNumber: rowIndex, sheetName, status: "FAILED", errorMessage },
              }).catch(() => {});
            }
            continue;
          }

          // ── C. Resolve derived fields ──────────────────────────────────
          const city         = getCell(values, headerMap, H_CITY);
          const detailedAddr = getCell(values, headerMap, H_ADDRESS);
          const address      = city ? `${city}، ${detailedAddr}` : detailedAddr;
          const notes        = getCell(values, headerMap, H_NOTES) || null;
          const unitPrice    = quantity > 0 ? paidAmount / quantity : 0;

          const nextValues = {
            customerName, phone, address,
            countryId:       country!.id,
            currencyId:      currency!.id,
            paymentMethodId: paymentMethod!.id,
            totalAmount:     paidAmount,
            notes,
            orderDate:       orderDate!,
            productId:       product!.id,
            quantity,
          };

          // ── D. Find existing order (visible/active only) ──────────────
          // IMPORTANT: only consider orders with deletedAt: null.
          // A soft-deleted order is invisible in the UI and must be treated
          // as non-existent so the sheet row can create a fresh order.
          let existingOrder: ExistingOrder | null = null;
          let detectedVia: string = "none";

          if (systemOrderIdInSheet) {
            existingOrder = await prisma.order.findFirst({
              where: { orderNumber: systemOrderIdInSheet, deletedAt: null },
              select: ORDER_SELECT,
            }) as ExistingOrder | null;

            if (existingOrder) {
              detectedVia = "systemOrderId";
              console.log("SYNC_EXISTING_ORDER_FOUND", { sheet: sheetName, rowIndex, via: "systemOrderId", orderNumber: existingOrder.orderNumber, externalOrderId: externalOrderId || "empty" });
            } else {
              // Detect soft-deleted version so we can log it specifically
              const hiddenCount = await prisma.order.count({
                where: { orderNumber: systemOrderIdInSheet, deletedAt: { not: null } },
              });
              if (hiddenCount > 0) {
                console.log("SYNC_EXISTING_ORDER_HIDDEN_OR_DELETED", { sheet: sheetName, rowIndex, orderNumber: systemOrderIdInSheet, action: "treating as new" });
              }
            }
          }

          if (!existingOrder && externalOrderId) {
            const log = importLogByExternalId.get(externalOrderId);
            if (log?.status === "SYNCED" && log.systemOrderId) {
              existingOrder = await prisma.order.findFirst({
                where: { id: log.systemOrderId, deletedAt: null },
                select: ORDER_SELECT,
              }) as ExistingOrder | null;

              if (existingOrder) {
                detectedVia = "importLog";
                console.log("SYNC_EXISTING_ORDER_FOUND", { sheet: sheetName, rowIndex, via: "importLog", orderId: log.systemOrderId, externalOrderId });
              } else {
                // Could be hard-deleted or soft-deleted — check which
                const hiddenCount = await prisma.order.count({
                  where: { id: log.systemOrderId, deletedAt: { not: null } },
                });
                if (hiddenCount > 0) {
                  console.log("SYNC_EXISTING_ORDER_HIDDEN_OR_DELETED", { sheet: sheetName, rowIndex, orderId: log.systemOrderId, action: "treating as new" });
                }
                // Either way, fall through to create a fresh order
              }
            } else if (log && log.status !== "SYNCED") {
              // Log was previously processed but in a non-SYNCED state (FAILED, DUPLICATE, DELETED)
              console.log("SYNC_IMPORT_LOG_EXISTS_NOT_SYNCED", { sheet: sheetName, rowIndex, externalOrderId, logStatus: log.status });
            }
          }

          // Log the per-row decision summary so every row is traceable
          console.log("GOOGLE_SYNC_ROW_DECISION", {
            sheet: sheetName,
            rowIndex,
            externalOrderId: externalOrderId || "empty",
            systemOrderIdInSheet: systemOrderIdInSheet || "empty",
            existingOrderNumber: existingOrder?.orderNumber ?? "none",
            detectedVia,
            mode,
          });

          // ── E. Existing order handling ─────────────────────────────────
          if (existingOrder) {
            if (mode === "update") {
              // "update" mode never modifies existing orders
              noChangeCount++;
              console.log("GOOGLE_SYNC_ACTION", { action: "SKIP", reason: "existing_order", sheet: sheetName, rowIndex, externalOrderId: externalOrderId || "empty", orderNumber: existingOrder.orderNumber, detectedVia, mode });
              sheetWriteBacks.push({
                rowIndex, syncStatus: "No Change",
                systemOrderId: existingOrder.orderNumber, errorMessage: "",
              });
              continue;
            }

            // "resync" mode — update if changed, otherwise no-change
            try {
              if (hasOrderChanged(existingOrder, nextValues)) {
                await prisma.$transaction(async (tx) => {
                  // Never update statusId during resync
                  await tx.order.update({
                    where: { id: existingOrder!.id },
                    data: {
                      customerName, phone, address,
                      countryId:       country!.id,
                      currencyId:      currency!.id,
                      paymentMethodId: paymentMethod!.id,
                      totalAmount:     paidAmount,
                      notes,
                      orderDate:       orderDate!,
                      // set externalOrderId if not already set
                      ...(externalOrderId && { externalOrderId }),
                    },
                  });
                  await tx.orderItem.deleteMany({ where: { orderId: existingOrder!.id } });
                  await tx.orderItem.create({
                    data: {
                      orderId:    existingOrder!.id,
                      productId:  product!.id,
                      quantity, unitPrice,
                      totalPrice: paidAmount,
                    },
                  });
                  await tx.orderAuditLog.create({
                    data: {
                      orderId:     existingOrder!.id,
                      action:      "UPDATE_ORDER",
                      changedById: employee!.id,
                      changedAt:   new Date(),
                      newValue:    `Resync update | External ID: ${externalOrderId || "N/A"}`,
                    },
                  });
                  if (externalOrderId) {
                    await tx.googleSheetImportLog.upsert({
                      where: { externalOrderId },
                      create: {
                        externalOrderId, spreadsheetId, sheetName,
                        rowNumber: rowIndex, systemOrderId: existingOrder!.id,
                        status: "SYNCED", importedAt: new Date(),
                      },
                      update: {
                        rowNumber: rowIndex, sheetName,
                        systemOrderId: existingOrder!.id,
                        status: "SYNCED", errorMessage: null, importedAt: new Date(),
                      },
                    });
                  }
                });

                updatedCount++;
                const normPhone = normalizePhone(phone);
                if (normPhone) existingPhones.add(normPhone);

                console.log("GOOGLE_SYNC_ACTION", { action: "UPDATE", sheet: sheetName, rowIndex, externalOrderId: externalOrderId || "empty", orderNumber: existingOrder.orderNumber, detectedVia, mode });
                sheetWriteBacks.push({
                  rowIndex, syncStatus: "Updated",
                  systemOrderId: existingOrder.orderNumber, errorMessage: "",
                });
              } else {
                noChangeCount++;
                console.log("GOOGLE_SYNC_ACTION", { action: "SKIP", reason: "no_change", sheet: sheetName, rowIndex, externalOrderId: externalOrderId || "empty", orderNumber: existingOrder.orderNumber, detectedVia, mode });
                sheetWriteBacks.push({
                  rowIndex, syncStatus: "No Change",
                  systemOrderId: existingOrder.orderNumber, errorMessage: "",
                });
              }
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : "خطأ غير متوقع أثناء التحديث";
              console.error("GOOGLE_SYNC_UPDATE_ERROR", { sheet: sheetName, rowIndex, error: errorMessage });
              failedCount++;
              sheetWriteBacks.push({ rowIndex, syncStatus: "Failed", systemOrderId: "", errorMessage });
            }
            continue;
          }

          // ── F. Duplicate check — phone only ────────────────────────────
          const normPhone = normalizePhone(phone);
          if (normPhone && existingPhones.has(normPhone)) {
            duplicateCount++;
            const errorMessage = "طلب مكرر بسبب رقم الجوال";
            console.warn("GOOGLE_SYNC_DUPLICATE", { sheet: sheetName, rowIndex, phone });
            sheetWriteBacks.push({ rowIndex, syncStatus: "Duplicate", systemOrderId: "", errorMessage });
            if (externalOrderId) {
              prisma.googleSheetImportLog.upsert({
                where: { externalOrderId },
                create: { externalOrderId, spreadsheetId, sheetName, rowNumber: rowIndex, status: "DUPLICATE", errorMessage },
                update: { rowNumber: rowIndex, sheetName, status: "DUPLICATE", errorMessage },
              }).catch(() => {});
            }
            continue;
          }

          // ── G. Create new order ────────────────────────────────────────
          try {
            const order = await prisma.$transaction(async (tx) => {
              const orderNumber = await generateOrderNumber(tx);

              const created = await tx.order.create({
                data: {
                  orderNumber, orderDate: orderDate!, customerName, phone, address,
                  countryId:       country!.id,
                  currencyId:      currency!.id,
                  paymentMethodId: paymentMethod!.id,
                  statusId:        initialStatus.id,
                  totalAmount:     paidAmount,
                  notes, isRepeatCustomer: false,
                  createdById:     employee!.id,
                  teamId:          employee!.teamId ?? null,
                  source:          "GOOGLE_SHEETS",
                  ...(externalOrderId && { externalOrderId }),
                  items: {
                    create: [{ productId: product!.id, quantity, unitPrice, totalPrice: paidAmount }],
                  },
                },
              });

              await tx.orderAuditLog.create({
                data: {
                  orderId: created.id, action: "IMPORT_ORDER_SHEETS",
                  changedById: employee!.id, changedAt: new Date(),
                  newValue: `External Order ID: ${externalOrderId || "N/A"} | Sheet: ${sheetName} | Mode: ${mode}`,
                },
              });

              if (receiptUrls.length > 0) {
                await tx.paymentReceipt.createMany({
                  data: receiptUrls.map((url) => ({
                    orderId: created.id, url, mimeType: guessMime(url),
                    size: 0, uploadedById: employee!.id,
                  })),
                });
                await tx.orderAuditLog.create({
                  data: {
                    orderId: created.id, action: "RECEIPT_UPLOADED",
                    changedById: employee!.id, changedAt: new Date(),
                  },
                });
              }

              if (externalOrderId) {
                await tx.googleSheetImportLog.upsert({
                  where: { externalOrderId },
                  create: {
                    externalOrderId, spreadsheetId, sheetName,
                    rowNumber: rowIndex, systemOrderId: created.id,
                    status: "SYNCED", importedAt: new Date(),
                  },
                  update: {
                    rowNumber: rowIndex, sheetName, systemOrderId: created.id,
                    status: "SYNCED", errorMessage: null, importedAt: new Date(),
                  },
                });
              }

              return created;
            });

            importedCount++;
            if (normPhone) existingPhones.add(normPhone);

            console.log("GOOGLE_SYNC_ACTION", { action: "CREATE", sheet: sheetName, rowIndex, externalOrderId: externalOrderId || "empty", orderNumber: order.orderNumber, mode });
            sheetWriteBacks.push({ rowIndex, syncStatus: "Synced", systemOrderId: order.orderNumber, errorMessage: "" });
            activityQueue.push({ userId: employee!.id, orderId: order.id, orderNumber: order.orderNumber });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "خطأ غير متوقع أثناء إنشاء الطلب";
            console.error("GOOGLE_SYNC_CREATE_ERROR", { sheet: sheetName, rowIndex, error: errorMessage });
            failedCount++;
            sheetWriteBacks.push({ rowIndex, syncStatus: "Failed", systemOrderId: "", errorMessage });
            if (externalOrderId) {
              prisma.googleSheetImportLog.upsert({
                where: { externalOrderId },
                create: { externalOrderId, spreadsheetId, sheetName, rowNumber: rowIndex, status: "FAILED", errorMessage },
                update: { rowNumber: rowIndex, sheetName, status: "FAILED", errorMessage },
              }).catch(() => {});
            }
          }
        }

        // ── Write results back to this sheet ─────────────────────────────
        if (sheetWriteBacks.length > 0) {
          try {
            await writeSheetResults(
              spreadsheetId, sheetName, sheetWriteBacks,
              syncStatusColIdx, systemOrderIdColIdx, errorMessageColIdx
            );
          } catch (err) {
            console.error(`[GoogleSheetsImport] write-back to "${sheetName}" failed:`, err);
          }
        }
      } catch (sheetErr) {
        sheetsSkipped++;
        console.error(`[GoogleSheetsImport] error on sheet "${sheetName}" — skipping:`, sheetErr);
      }
    }

    // ── 4. Resync delete phase ─────────────────────────────────────────────
    if (mode === "resync" && allSeenExternalIds.size > 0) {
      console.log(`[GoogleSheetsImport] resync delete phase — seen ${allSeenExternalIds.size} external IDs`);
      try {
        // Find orders that came from Google Sheets but are no longer in any sheet
        const toDelete = await prisma.order.findMany({
          where: {
            source: "GOOGLE_SHEETS",
            externalOrderId: { not: null, notIn: Array.from(allSeenExternalIds) },
            deletedAt: null,
          },
          select: { id: true, orderNumber: true, externalOrderId: true },
        });

        console.log("SYNC_DELETE_COUNT", { toDelete: toDelete.length, seenExternalIds: allSeenExternalIds.size });
        console.log(`[GoogleSheetsImport] resync delete phase — ${toDelete.length} orders to hard-delete`);

        for (const ord of toDelete) {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.order.delete({ where: { id: ord.id } });
              if (ord.externalOrderId) {
                await tx.googleSheetImportLog.updateMany({
                  where: { systemOrderId: ord.id },
                  data: { status: "DELETED", systemOrderId: null },
                });
              }
            });
            deletedCount++;
            console.log("GOOGLE_SYNC_DELETED", { orderNumber: ord.orderNumber, externalOrderId: ord.externalOrderId });
          } catch (err) {
            console.error("GOOGLE_SYNC_DELETE_ERROR", { orderNumber: ord.orderNumber, error: err instanceof Error ? err.message : String(err) });
          }
        }
      } catch (err) {
        console.error("[GoogleSheetsImport] resync delete phase failed:", err);
      }
    } else if (mode === "resync") {
      // allSeenExternalIds is empty — no sheets had any external IDs, skip delete to be safe
      console.log("[GoogleSheetsImport] resync delete phase skipped — no external IDs found in sheets");
    }

    // ── 5. Activity logs ───────────────────────────────────────────────────
    if (activityQueue.length > 0) {
      prisma.activityLog
        .createMany({
          data: activityQueue.map(({ userId, orderId, orderNumber }) => ({
            userId, action: "IMPORT_ORDERS", entityType: "Order", entityId: orderId,
            details: { orderNumber, source: "google_sheets", mode } as Prisma.InputJsonValue,
          })),
        })
        .catch((err) => console.error("[GoogleSheetsImport] activity log batch failed:", err));
    }

    // ── 6. Finalise sync run ───────────────────────────────────────────────
    const finishedAt  = new Date();
    const durationSec = ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1);

    console.log("GOOGLE_SYNC_SUMMARY", {
      mode, durationSec, totalSheets, sheetsSkipped, totalRows,
      importedCount, updatedCount, noChangeCount,
      skippedEmptyCount, duplicateCount, failedCount, deletedCount,
    });

    await prisma.googleSheetSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED", finishedAt, mode,
        totalSheets, sheetsSkipped, totalRows,
        importedCount, updatedCount, noChangeCount,
        skippedCount: skippedEmptyCount, duplicateCount, failedCount, deletedCount,
      },
    });

    return {
      syncRunId: syncRun.id, mode, totalSheets, sheetsSkipped, totalRows,
      importedCount, updatedCount, noChangeCount,
      skippedEmptyCount, duplicateCount, failedCount, deletedCount,
      startedAt, finishedAt,
    };
  } catch (err) {
    console.error("[GoogleSheetsImport] fatal error:", err);
    const finishedAt   = new Date();
    const errorSummary = err instanceof Error ? err.message : "خطأ غير متوقع";
    await prisma.googleSheetSyncRun
      .update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED", finishedAt, mode,
          totalSheets, sheetsSkipped, totalRows,
          importedCount, updatedCount, noChangeCount,
          skippedCount: skippedEmptyCount, duplicateCount, failedCount, deletedCount,
          errorSummary,
        },
      })
      .catch(() => {});
    throw err;
  }
}
