import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/order-number";
import { readSheet, writeSheetResults } from "@/lib/google-sheets";

// ─── Column header names (must match the sheet header row exactly) ─────────────

const H_EXTERNAL_ID = "External Order ID";
const H_ORDER_DATE = "Order Date";
const H_CUSTOMER_NAME = "Customer Name";
const H_PHONE = "Phone";
const H_COUNTRY = "Country";
const H_CITY = "City";
const H_ADDRESS = "Detailed Address";
const H_PRODUCT = "Product";
const H_QUANTITY = "Quantity";
const H_PAID_AMOUNT = "Paid Amount";
const H_CURRENCY = "Currency";
const H_PAYMENT_METHOD = "Payment Method";
const H_RECEIPT_1 = "Receipt URL 1";
const H_RECEIPT_2 = "Receipt URL 2";
const H_RECEIPT_3 = "Receipt URL 3";
const H_NOTES = "Notes";
const H_EMPLOYEE_EMAIL = "Employee Email";
const H_SYNC_STATUS = "Sync Status";
const H_SYSTEM_ORDER_ID = "System Order ID";
const H_ERROR_MESSAGE = "Error Message";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncResult = {
  syncRunId: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  startedAt: Date;
  finishedAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type HeaderMap = Record<string, number>;

function getCell(values: string[], map: HeaderMap, col: string): string {
  const idx = map[col];
  return idx !== undefined ? (values[idx] ?? "") : "";
}

function lc(s: string): string {
  return s.trim().toLowerCase();
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
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;

  // ISO date string
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  // Excel numeric serial (date-fns style)
  const serial = Number(raw);
  if (!isNaN(serial) && serial > 1000 && serial < 2958466) {
    const d = new Date(new Date(1899, 11, 30).getTime() + serial * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: let JS parse
  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs the Google Sheets import process:
 *   1. Read rows from the configured sheet.
 *   2. Validate each row and match against DB entities.
 *   3. Create orders row-by-row (individual transactions with advisory lock).
 *   4. Write Sync Status / System Order ID / Error Message back to the sheet.
 *   5. Update the GoogleSheetSyncRun record with final counts.
 *
 * The function is idempotent: rows already marked "Synced" in the import log
 * are skipped safely without creating duplicates.
 */
export async function runGoogleSheetsImport(
  triggeredBy: "MANUAL" | "CRON",
  triggeredByUserId?: string
): Promise<SyncResult> {
  const startedAt = new Date();

  const syncRun = await prisma.googleSheetSyncRun.create({
    data: {
      startedAt,
      triggeredBy,
      triggeredByUserId: triggeredByUserId ?? null,
      status: "RUNNING",
    },
  });

  let totalRows = 0;
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    // ── 1. Read sheet ────────────────────────────────────────────────────────
    const { spreadsheetId, sheetName, headers, rows } = await readSheet();

    if (headers.length === 0 || rows.length === 0) {
      const finishedAt = new Date();
      await prisma.googleSheetSyncRun.update({
        where: { id: syncRun.id },
        data: { status: "COMPLETED", finishedAt, totalRows: 0 },
      });
      return { syncRunId: syncRun.id, totalRows: 0, importedCount: 0, skippedCount: 0, failedCount: 0, startedAt, finishedAt };
    }

    const headerMap: HeaderMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    // Locate the write-back columns (required)
    const syncStatusColIdx = headerMap[H_SYNC_STATUS];
    const systemOrderIdColIdx = headerMap[H_SYSTEM_ORDER_ID];
    const errorMessageColIdx = headerMap[H_ERROR_MESSAGE];

    if (syncStatusColIdx === undefined || systemOrderIdColIdx === undefined || errorMessageColIdx === undefined) {
      throw new Error(
        `أعمدة مطلوبة مفقودة في الورقة: ${[
          syncStatusColIdx === undefined ? H_SYNC_STATUS : null,
          systemOrderIdColIdx === undefined ? H_SYSTEM_ORDER_ID : null,
          errorMessageColIdx === undefined ? H_ERROR_MESSAGE : null,
        ]
          .filter(Boolean)
          .join("، ")}`
      );
    }

    // ── 2. Load all lookup data in a single pass ─────────────────────────────
    const [
      countries,
      currencies,
      paymentMethods,
      products,
      employees,
      initialStatus,
      existingLogs,
    ] = await Promise.all([
      prisma.country.findMany({ where: { deletedAt: null } }),
      prisma.currency.findMany({ where: { deletedAt: null } }),
      prisma.paymentMethod.findMany({ where: { deletedAt: null } }),
      prisma.product.findMany({ where: { deletedAt: null, isActive: true } }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, email: true, name: true, teamId: true },
      }),
      prisma.shippingStatusPrimary.findFirst({ where: { name: "جاهز للشحن", isActive: true } }),
      prisma.googleSheetImportLog.findMany({
        where: { spreadsheetId },
        select: { externalOrderId: true, status: true, systemOrderId: true },
      }),
    ]);

    if (!initialStatus) {
      throw new Error("حالة 'جاهز للشحن' غير موجودة في إعدادات النظام");
    }

    // Build in-memory lookup maps (case-insensitive)
    const countryByName = new Map(countries.map((c) => [lc(c.name), c]));
    const countryByCode = new Map(countries.map((c) => [lc(c.code), c]));
    const currencyByName = new Map(currencies.map((c) => [lc(c.name), c]));
    const currencyByCode = new Map(currencies.map((c) => [lc(c.code), c]));
    const pmByName = new Map(paymentMethods.map((p) => [lc(p.name), p]));
    const productByName = new Map(products.map((p) => [lc(p.name), p]));
    const productBySku = new Map(
      products.filter((p) => p.sku).map((p) => [lc(p.sku!), p])
    );
    const employeeByEmail = new Map(employees.map((e) => [lc(e.email), e]));
    const importLogByExternalId = new Map(
      existingLogs.map((l) => [l.externalOrderId, l])
    );

    // ── 3. Process rows ──────────────────────────────────────────────────────
    type WriteBack = { rowIndex: number; syncStatus: string; systemOrderId: string; errorMessage: string };
    const writeBacks: WriteBack[] = [];
    const activityQueue: Array<{ userId: string; orderId: string; orderNumber: string }> = [];

    // Only process rows NOT already marked "Synced" in the sheet itself
    const candidateRows = rows.filter(
      (r) => lc(getCell(r.values, headerMap, H_SYNC_STATUS)) !== "synced"
    );
    totalRows = candidateRows.length;

    for (const row of candidateRows) {
      const { rowIndex, values } = row;
      const externalOrderId = getCell(values, headerMap, H_EXTERNAL_ID);

      // ── Duplicate guard via import log ──
      if (externalOrderId) {
        const log = importLogByExternalId.get(externalOrderId);
        if (log?.status === "SYNCED") {
          skippedCount++;
          writeBacks.push({
            rowIndex,
            syncStatus: "Synced",
            systemOrderId: log.systemOrderId ?? "",
            errorMessage: "",
          });
          continue;
        }
      }

      // ── Validation ──────────────────────────────────────────────────────
      const errs: string[] = [];

      if (!externalOrderId) errs.push("External Order ID مطلوب");

      const orderDateRaw = getCell(values, headerMap, H_ORDER_DATE);
      const orderDate = orderDateRaw ? parseDate(orderDateRaw) : null;
      if (!orderDateRaw) errs.push("Order Date مطلوب");
      else if (!orderDate) errs.push(`تنسيق تاريخ غير صحيح: ${orderDateRaw}`);

      const customerName = getCell(values, headerMap, H_CUSTOMER_NAME);
      if (!customerName) errs.push("Customer Name مطلوب");

      const phone = getCell(values, headerMap, H_PHONE);
      if (!phone) errs.push("Phone مطلوب");

      const countryName = getCell(values, headerMap, H_COUNTRY);
      const country =
        countryByName.get(lc(countryName)) ?? countryByCode.get(lc(countryName));
      if (!countryName) errs.push("Country مطلوب");
      else if (!country) errs.push(`الدولة غير موجودة: ${countryName}`);

      const productName = getCell(values, headerMap, H_PRODUCT);
      const product =
        productByName.get(lc(productName)) ?? productBySku.get(lc(productName));
      if (!productName) errs.push("Product مطلوب");
      else if (!product) errs.push(`المنتج غير موجود: ${productName}`);

      const quantityRaw = getCell(values, headerMap, H_QUANTITY);
      const quantity = parseInt(quantityRaw, 10);
      if (!quantityRaw) errs.push("Quantity مطلوب");
      else if (isNaN(quantity) || quantity < 1) errs.push(`الكمية يجب أن تكون عدداً صحيحاً موجباً: ${quantityRaw}`);

      const paidAmountRaw = getCell(values, headerMap, H_PAID_AMOUNT);
      const paidAmount = parseFloat(paidAmountRaw);
      if (!paidAmountRaw) errs.push("Paid Amount مطلوب");
      else if (isNaN(paidAmount) || paidAmount < 0) errs.push(`المبلغ غير صحيح: ${paidAmountRaw}`);

      const currencyName = getCell(values, headerMap, H_CURRENCY);
      const currency =
        currencyByName.get(lc(currencyName)) ?? currencyByCode.get(lc(currencyName));
      if (!currencyName) errs.push("Currency مطلوب");
      else if (!currency) errs.push(`العملة غير موجودة: ${currencyName}`);

      const pmName = getCell(values, headerMap, H_PAYMENT_METHOD);
      const paymentMethod = pmByName.get(lc(pmName));
      if (!pmName) errs.push("Payment Method مطلوب");
      else if (!paymentMethod) errs.push(`طريقة الدفع غير موجودة: ${pmName}`);

      const employeeEmail = getCell(values, headerMap, H_EMPLOYEE_EMAIL);
      const employee = employeeByEmail.get(lc(employeeEmail));
      if (!employeeEmail) errs.push("Employee Email مطلوب");
      else if (!employee) errs.push(`الموظف غير موجود أو غير نشط: ${employeeEmail}`);

      // Receipt URL validation
      const receiptUrls = [
        getCell(values, headerMap, H_RECEIPT_1),
        getCell(values, headerMap, H_RECEIPT_2),
        getCell(values, headerMap, H_RECEIPT_3),
      ].filter(Boolean);

      for (const url of receiptUrls) {
        if (!isValidHttpUrl(url)) {
          errs.push(`رابط إيصال غير صحيح: ${url.substring(0, 80)}`);
        }
      }

      if (errs.length > 0) {
        failedCount++;
        const errorMessage = errs.join(" | ");
        writeBacks.push({ rowIndex, syncStatus: "Failed", systemOrderId: "", errorMessage });
        if (externalOrderId) {
          // Best-effort — non-fatal if it fails
          prisma.googleSheetImportLog
            .upsert({
              where: { externalOrderId },
              create: { externalOrderId, spreadsheetId, sheetName, rowNumber: rowIndex, status: "FAILED", errorMessage },
              update: { rowNumber: rowIndex, status: "FAILED", errorMessage },
            })
            .catch(() => {});
        }
        continue;
      }

      // ── Create order ─────────────────────────────────────────────────────
      const city = getCell(values, headerMap, H_CITY);
      const detailedAddr = getCell(values, headerMap, H_ADDRESS);
      const address = city ? `${city}، ${detailedAddr}` : detailedAddr;
      const notes = getCell(values, headerMap, H_NOTES) || null;
      const unitPrice = quantity > 0 ? paidAmount / quantity : 0;

      try {
        const order = await prisma.$transaction(async (tx) => {
          const orderNumber = await generateOrderNumber(tx);

          const created = await tx.order.create({
            data: {
              orderNumber,
              orderDate: orderDate!,
              customerName,
              phone,
              address,
              countryId: country!.id,
              currencyId: currency!.id,
              paymentMethodId: paymentMethod!.id,
              statusId: initialStatus.id,
              totalAmount: paidAmount,
              notes,
              isRepeatCustomer: false,
              createdById: employee!.id,
              teamId: employee!.teamId ?? null,
              items: {
                create: [{ productId: product!.id, quantity, unitPrice, totalPrice: paidAmount }],
              },
            },
          });

          await tx.orderAuditLog.create({
            data: {
              orderId: created.id,
              action: "IMPORT_ORDER_SHEETS",
              changedById: employee!.id,
              changedAt: new Date(),
              newValue: `External Order ID: ${externalOrderId}`,
            },
          });

          if (receiptUrls.length > 0) {
            await tx.paymentReceipt.createMany({
              data: receiptUrls.map((url) => ({
                orderId: created.id,
                url,
                mimeType: guessMime(url),
                size: 0,
                uploadedById: employee!.id,
              })),
            });
            await tx.orderAuditLog.create({
              data: {
                orderId: created.id,
                action: "RECEIPT_UPLOADED",
                changedById: employee!.id,
                changedAt: new Date(),
              },
            });
          }

          await tx.googleSheetImportLog.upsert({
            where: { externalOrderId },
            create: {
              externalOrderId,
              spreadsheetId,
              sheetName,
              rowNumber: rowIndex,
              systemOrderId: created.id,
              status: "SYNCED",
              importedAt: new Date(),
            },
            update: {
              rowNumber: rowIndex,
              systemOrderId: created.id,
              status: "SYNCED",
              errorMessage: null,
              importedAt: new Date(),
            },
          });

          return created;
        });

        importedCount++;
        writeBacks.push({
          rowIndex,
          syncStatus: "Synced",
          systemOrderId: order.orderNumber,
          errorMessage: "",
        });
        activityQueue.push({
          userId: employee!.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
        });
      } catch (err) {
        console.error(`[GoogleSheetsImport] row ${rowIndex} order creation failed:`, err);
        failedCount++;
        const errorMessage =
          err instanceof Error ? err.message : "خطأ غير متوقع أثناء إنشاء الطلب";
        writeBacks.push({ rowIndex, syncStatus: "Failed", systemOrderId: "", errorMessage });
        if (externalOrderId) {
          prisma.googleSheetImportLog
            .upsert({
              where: { externalOrderId },
              create: { externalOrderId, spreadsheetId, sheetName, rowNumber: rowIndex, status: "FAILED", errorMessage },
              update: { rowNumber: rowIndex, status: "FAILED", errorMessage },
            })
            .catch(() => {});
        }
      }
    }

    // ── 4. Write results back to sheet ───────────────────────────────────────
    if (writeBacks.length > 0) {
      try {
        await writeSheetResults(
          spreadsheetId,
          sheetName,
          writeBacks,
          syncStatusColIdx,
          systemOrderIdColIdx,
          errorMessageColIdx
        );
      } catch (err) {
        // Non-fatal: orders were created; just log the write-back failure.
        console.error("[GoogleSheetsImport] write-back to sheet failed:", err);
      }
    }

    // ── 5. Activity logs — fire-and-forget ───────────────────────────────────
    if (activityQueue.length > 0) {
      prisma.activityLog
        .createMany({
          data: activityQueue.map(({ userId, orderId, orderNumber }) => ({
            userId,
            action: "IMPORT_ORDER_SHEETS",
            entityType: "Order",
            entityId: orderId,
            details: { orderNumber, source: "google_sheets" } as Prisma.InputJsonValue,
          })),
        })
        .catch((err) =>
          console.error("[GoogleSheetsImport] activity log batch failed:", err)
        );
    }

    // ── 6. Finalise sync run ──────────────────────────────────────────────────
    const finishedAt = new Date();
    await prisma.googleSheetSyncRun.update({
      where: { id: syncRun.id },
      data: { status: "COMPLETED", finishedAt, totalRows, importedCount, skippedCount, failedCount },
    });

    return { syncRunId: syncRun.id, totalRows, importedCount, skippedCount, failedCount, startedAt, finishedAt };
  } catch (err) {
    console.error("[GoogleSheetsImport] fatal error:", err);
    const finishedAt = new Date();
    const errorSummary = err instanceof Error ? err.message : "خطأ غير متوقع";
    await prisma.googleSheetSyncRun
      .update({
        where: { id: syncRun.id },
        data: { status: "FAILED", finishedAt, totalRows, importedCount, skippedCount, failedCount, errorSummary },
      })
      .catch(() => {});
    throw err;
  }
}

