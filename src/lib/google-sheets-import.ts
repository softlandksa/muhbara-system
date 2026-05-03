import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/order-number";
import { listSheets, readSheetByName, writeSheetResults } from "@/lib/google-sheets";

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
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  failedCount: number;
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

function getCell(values: string[], map: HeaderMap, col: string): string {
  const idx = map[col];
  return idx !== undefined ? (values[idx] ?? "") : "";
}

function lc(s: string): string {
  return s.trim().toLowerCase();
}

/** Strips all non-digit chars then leading zeros for phone comparison. */
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "");
}

/** Trims, collapses whitespace, lowercases for name comparison. */
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(
      `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}T00:00:00`
    );
    return isNaN(d.getTime()) ? null : d;
  }

  const serial = Number(raw);
  if (!isNaN(serial) && serial > 1000 && serial < 2958466) {
    const d = new Date(new Date(1899, 11, 30).getTime() + serial * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Scans every sheet/tab in the configured spreadsheet and imports new orders.
 *
 * Per-sheet behaviour:
 *   - Sheets missing the required write-back columns are silently skipped.
 *   - Errors reading one sheet do not abort processing of subsequent sheets.
 *
 * Duplicate prevention:
 *   - Rows whose External Order ID is already in the import log as SYNCED → skipped.
 *   - Rows whose customer name OR phone matches an existing order → Duplicate.
 *   - Newly imported customers are added to the in-memory sets so the same
 *     customer cannot be created twice within the same sync run across sheets.
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

  let totalSheets = 0;
  let sheetsSkipped = 0;
  let totalRows = 0;
  let importedCount = 0;
  let skippedCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;

  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID غير مكوّن");

    console.log(
      `[GoogleSheetsImport] starting ${triggeredBy} sync (run id: ${syncRun.id})`
    );

    // ── 1. Discover all sheets ──────────────────────────────────────────────
    const sheetNames = await listSheets(spreadsheetId);
    totalSheets = sheetNames.length;
    console.log(
      `[GoogleSheetsImport] ${totalSheets} sheet(s) discovered: ${sheetNames.join(", ")}`
    );

    if (totalSheets === 0) {
      const finishedAt = new Date();
      await prisma.googleSheetSyncRun.update({
        where: { id: syncRun.id },
        data: { status: "COMPLETED", finishedAt, totalSheets: 0 },
      });
      return {
        syncRunId: syncRun.id,
        totalSheets: 0, sheetsSkipped: 0, totalRows: 0,
        importedCount: 0, skippedCount: 0, duplicateCount: 0, failedCount: 0,
        startedAt, finishedAt,
      };
    }

    // ── 2. Load all DB lookup data (shared across every sheet) ─────────────
    const [
      countries,
      currencies,
      paymentMethods,
      products,
      employees,
      initialStatus,
      existingLogs,
      existingOrders,
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
      prisma.order.findMany({
        select: { customerName: true, phone: true },
      }),
    ]);

    if (!initialStatus) {
      throw new Error("حالة 'جاهز للشحن' غير موجودة في إعدادات النظام");
    }

    // Case-insensitive entity maps
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

    // Duplicate-customer detection sets — seeded with all existing orders,
    // then extended as new orders are created during this run.
    const existingPhones = new Set(
      existingOrders.map((o) => normalizePhone(o.phone)).filter(Boolean)
    );
    const existingNames = new Set(
      existingOrders.map((o) => normalizeName(o.customerName)).filter(Boolean)
    );

    // Activity logs — fire-and-forget after all sheets are processed
    const activityQueue: Array<{
      userId: string;
      orderId: string;
      orderNumber: string;
    }> = [];

    // ── 3. Loop through every sheet ────────────────────────────────────────
    for (const sheetName of sheetNames) {
      console.log(`[GoogleSheetsImport] processing sheet: ${sheetName}`);

      try {
        const { headers, rows } = await readSheetByName(spreadsheetId, sheetName);

        if (headers.length === 0) {
          sheetsSkipped++;
          console.log(
            `[GoogleSheetsImport] sheet "${sheetName}" skipped — empty or no header row`
          );
          continue;
        }

        const headerMap: HeaderMap = {};
        headers.forEach((h, i) => {
          if (h) headerMap[h] = i;
        });

        // Write-back columns must all be present — otherwise skip this sheet
        const syncStatusColIdx = headerMap[H_SYNC_STATUS];
        const systemOrderIdColIdx = headerMap[H_SYSTEM_ORDER_ID];
        const errorMessageColIdx = headerMap[H_ERROR_MESSAGE];

        if (
          syncStatusColIdx === undefined ||
          systemOrderIdColIdx === undefined ||
          errorMessageColIdx === undefined
        ) {
          sheetsSkipped++;
          const missing = [
            syncStatusColIdx === undefined ? H_SYNC_STATUS : null,
            systemOrderIdColIdx === undefined ? H_SYSTEM_ORDER_ID : null,
            errorMessageColIdx === undefined ? H_ERROR_MESSAGE : null,
          ]
            .filter(Boolean)
            .join(", ");
          console.log(
            `[GoogleSheetsImport] sheet "${sheetName}" skipped — missing required columns: ${missing}`
          );
          continue;
        }

        if (rows.length === 0) {
          console.log(
            `[GoogleSheetsImport] sheet "${sheetName}" — no data rows, nothing to process`
          );
          continue;
        }

        // Only process rows not already marked Synced in the sheet itself
        const candidateRows = rows.filter(
          (r) => lc(getCell(r.values, headerMap, H_SYNC_STATUS)) !== "synced"
        );
        totalRows += candidateRows.length;

        console.log(
          `[GoogleSheetsImport] sheet "${sheetName}" — ` +
          `total rows: ${rows.length}, candidates: ${candidateRows.length}, ` +
          `already synced in sheet: ${rows.length - candidateRows.length}`
        );

        const sheetWriteBacks: WriteBack[] = [];

        for (const row of candidateRows) {
          const { rowIndex, values } = row;
          const externalOrderId = getCell(values, headerMap, H_EXTERNAL_ID);

          // ── Duplicate guard via import log ─────────────────────────────
          if (externalOrderId) {
            const log = importLogByExternalId.get(externalOrderId);
            if (log?.status === "SYNCED") {
              skippedCount++;
              sheetWriteBacks.push({
                rowIndex,
                syncStatus: "Synced",
                systemOrderId: log.systemOrderId ?? "",
                errorMessage: "",
              });
              continue;
            }
          }

          // ── Validation ─────────────────────────────────────────────────
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
          else if (isNaN(quantity) || quantity < 1)
            errs.push(`الكمية يجب أن تكون عدداً صحيحاً موجباً: ${quantityRaw}`);

          const paidAmountRaw = getCell(values, headerMap, H_PAID_AMOUNT);
          const paidAmount = parseFloat(paidAmountRaw);
          if (!paidAmountRaw) errs.push("Paid Amount مطلوب");
          else if (isNaN(paidAmount) || paidAmount < 0)
            errs.push(`المبلغ غير صحيح: ${paidAmountRaw}`);

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
            console.warn(
              `[GoogleSheetsImport] sheet="${sheetName}" row ${rowIndex} validation failed: ${errorMessage}`
            );
            sheetWriteBacks.push({
              rowIndex,
              syncStatus: "Failed",
              systemOrderId: "",
              errorMessage,
            });
            if (externalOrderId) {
              prisma.googleSheetImportLog
                .upsert({
                  where: { externalOrderId },
                  create: {
                    externalOrderId, spreadsheetId, sheetName,
                    rowNumber: rowIndex, status: "FAILED", errorMessage,
                  },
                  update: {
                    rowNumber: rowIndex, sheetName, status: "FAILED", errorMessage,
                  },
                })
                .catch(() => {});
            }
            continue;
          }

          // ── Duplicate customer check ───────────────────────────────────
          const normPhone = normalizePhone(phone);
          const normName = normalizeName(customerName);
          const phoneMatches = normPhone.length > 0 && existingPhones.has(normPhone);
          const nameMatches = normName.length > 0 && existingNames.has(normName);

          if (phoneMatches || nameMatches) {
            duplicateCount++;
            const errorMessage =
              phoneMatches && nameMatches
                ? "طلب مكرر بسبب تطابق اسم العميل أو رقم الجوال"
                : phoneMatches
                ? "طلب مكرر بسبب تطابق رقم الجوال"
                : "طلب مكرر بسبب تطابق اسم العميل";
            console.warn(
              `[GoogleSheetsImport] sheet="${sheetName}" row ${rowIndex} — ` +
              `duplicate: name="${customerName}" phone="${phone}" ` +
              `(phoneMatch=${phoneMatches} nameMatch=${nameMatches})`
            );
            sheetWriteBacks.push({
              rowIndex,
              syncStatus: "Duplicate",
              systemOrderId: "",
              errorMessage,
            });
            if (externalOrderId) {
              prisma.googleSheetImportLog
                .upsert({
                  where: { externalOrderId },
                  create: {
                    externalOrderId, spreadsheetId, sheetName,
                    rowNumber: rowIndex, status: "DUPLICATE", errorMessage,
                  },
                  update: {
                    rowNumber: rowIndex, sheetName, status: "DUPLICATE", errorMessage,
                  },
                })
                .catch(() => {});
            }
            continue;
          }

          // ── Create order ───────────────────────────────────────────────
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
                    create: [
                      {
                        productId: product!.id,
                        quantity,
                        unitPrice,
                        totalPrice: paidAmount,
                      },
                    ],
                  },
                },
              });

              await tx.orderAuditLog.create({
                data: {
                  orderId: created.id,
                  action: "IMPORT_ORDER_SHEETS",
                  changedById: employee!.id,
                  changedAt: new Date(),
                  newValue: `External Order ID: ${externalOrderId} | Sheet: ${sheetName}`,
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
                  sheetName,
                  systemOrderId: created.id,
                  status: "SYNCED",
                  errorMessage: null,
                  importedAt: new Date(),
                },
              });

              return created;
            });

            importedCount++;
            // Register newly imported customer so the same person isn't imported
            // again from another sheet within this sync run.
            if (normPhone) existingPhones.add(normPhone);
            if (normName) existingNames.add(normName);

            console.log(
              `[GoogleSheetsImport] sheet="${sheetName}" row ${rowIndex} ` +
              `imported → ${order.orderNumber} (externalId: ${externalOrderId})`
            );
            sheetWriteBacks.push({
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
            console.error(
              `[GoogleSheetsImport] sheet="${sheetName}" row ${rowIndex} order creation failed:`,
              err
            );
            failedCount++;
            const errorMessage =
              err instanceof Error ? err.message : "خطأ غير متوقع أثناء إنشاء الطلب";
            sheetWriteBacks.push({
              rowIndex,
              syncStatus: "Failed",
              systemOrderId: "",
              errorMessage,
            });
            if (externalOrderId) {
              prisma.googleSheetImportLog
                .upsert({
                  where: { externalOrderId },
                  create: {
                    externalOrderId, spreadsheetId, sheetName,
                    rowNumber: rowIndex, status: "FAILED", errorMessage,
                  },
                  update: {
                    rowNumber: rowIndex, sheetName, status: "FAILED", errorMessage,
                  },
                })
                .catch(() => {});
            }
          }
        }

        // ── Write results back to this sheet ─────────────────────────────
        if (sheetWriteBacks.length > 0) {
          try {
            await writeSheetResults(
              spreadsheetId,
              sheetName,
              sheetWriteBacks,
              syncStatusColIdx,
              systemOrderIdColIdx,
              errorMessageColIdx
            );
          } catch (err) {
            console.error(
              `[GoogleSheetsImport] write-back to sheet "${sheetName}" failed:`,
              err
            );
          }
        }
      } catch (sheetErr) {
        // A fatal read error on one sheet must not abort the rest.
        sheetsSkipped++;
        console.error(
          `[GoogleSheetsImport] error processing sheet "${sheetName}" — skipping:`,
          sheetErr
        );
      }
    }

    // ── 4. Activity logs — fire-and-forget ─────────────────────────────────
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

    // ── 5. Finalise sync run ───────────────────────────────────────────────
    const finishedAt = new Date();
    const durationSec = (
      (finishedAt.getTime() - startedAt.getTime()) / 1000
    ).toFixed(1);
    console.log(
      `[GoogleSheetsImport] sync COMPLETED in ${durationSec}s — ` +
      `sheets: ${totalSheets} (skipped: ${sheetsSkipped}) | ` +
      `rows: ${totalRows} | imported: ${importedCount} | ` +
      `duplicates: ${duplicateCount} | skipped: ${skippedCount} | failed: ${failedCount}`
    );
    console.log("GOOGLE_SYNC_IMPORTED_COUNT", importedCount);
    console.log("GOOGLE_SYNC_DUPLICATE_COUNT", duplicateCount);
    console.log("GOOGLE_SYNC_FAILED_COUNT", failedCount);

    await prisma.googleSheetSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED",
        finishedAt,
        totalSheets,
        sheetsSkipped,
        totalRows,
        importedCount,
        skippedCount,
        duplicateCount,
        failedCount,
      },
    });

    return {
      syncRunId: syncRun.id,
      totalSheets,
      sheetsSkipped,
      totalRows,
      importedCount,
      skippedCount,
      duplicateCount,
      failedCount,
      startedAt,
      finishedAt,
    };
  } catch (err) {
    console.error("[GoogleSheetsImport] fatal error:", err);
    const finishedAt = new Date();
    const errorSummary = err instanceof Error ? err.message : "خطأ غير متوقع";
    await prisma.googleSheetSyncRun
      .update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED",
          finishedAt,
          totalSheets,
          sheetsSkipped,
          totalRows,
          importedCount,
          skippedCount,
          duplicateCount,
          failedCount,
          errorSummary,
        },
      })
      .catch(() => {});
    throw err;
  }
}
