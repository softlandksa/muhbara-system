import { prisma } from "@/lib/prisma";
import { listSheets, readSheetByName, writeShippingResults } from "@/lib/google-sheets";

// ─── Column header names (must match sheet header row exactly) ────────────────

const H_SYSTEM_ORDER_ID    = "System Order ID";
const H_ERROR_MESSAGE      = "Error Message";
const H_SHIPPING_STATUS    = "Shipping Status";
const H_SHIPPING_COMPANY   = "Shipping Company";
const H_TRACKING_NUMBER    = "Tracking Number";
const H_LAST_SHIPPING_SYNC = "Last Shipping Sync";

// ─── Types ────────────────────────────────────────────────────────────────────

type HeaderMap = Record<string, number>;

export type ShippingSyncResult = {
  syncRunId: string;
  totalRows: number;
  updatedCount: number;
  noChangeCount: number;
  skippedEmptyCount: number;
  notFoundCount: number;
  failedCount: number;
  startedAt: Date;
  finishedAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCell(values: string[], map: HeaderMap, col: string): string {
  const idx = map[col];
  return idx !== undefined ? (values[idx] ?? "").trim() : "";
}

function buildHeaderMap(headers: string[]): HeaderMap {
  const map: HeaderMap = {};
  headers.forEach((h, i) => { map[h.trim()] = i; });
  return map;
}

/** Returns true when the row has no System Order ID and no shipping data at all. */
function isShippingRowEmpty(values: string[], map: HeaderMap): boolean {
  return (
    !getCell(values, map, H_SYSTEM_ORDER_ID) &&
    !getCell(values, map, H_SHIPPING_STATUS) &&
    !getCell(values, map, H_SHIPPING_COMPANY) &&
    !getCell(values, map, H_TRACKING_NUMBER)
  );
}

/** Formats a Date as D-MMM-YYYY (English month abbr) — matches the system date format. */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatSyncDate(d: Date): string {
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Reads shipping columns from all sheets in the configured spreadsheet and
 * updates ONLY shipping-related fields (shippingStatus, shippingCompany,
 * trackingNumber) on existing orders.
 *
 * Never creates orders, never deletes orders, never touches financial or
 * customer data. This is a fully independent shipping synchronisation layer.
 */
export async function syncShippingFromGoogleSheets(
  triggeredBy: "MANUAL",
  triggeredByUserId: string,
): Promise<ShippingSyncResult> {
  const startedAt = new Date();

  const syncRun = await prisma.shippingSheetSyncRun.create({
    data: {
      startedAt,
      triggeredBy,
      triggeredByUserId,
      status: "RUNNING",
    },
  });

  let totalRows         = 0;
  let updatedCount      = 0;
  let noChangeCount     = 0;
  let skippedEmptyCount = 0;
  let notFoundCount     = 0;
  let failedCount       = 0;

  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID غير مكوّن");

    console.log(`[ShippingSync] starting MANUAL sync (run id: ${syncRun.id})`);

    // ── 1. Pre-load lookup tables ────────────────────────────────────────────
    const [primaryStatuses, companies] = await Promise.all([
      prisma.shippingStatusPrimary.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.shippingCompany.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const statusByName  = new Map(primaryStatuses.map((s) => [s.name.trim(), s.id]));
    const companyByName = new Map(companies.map((c) => [c.name.trim(), c.id]));

    // ── 2. Discover sheets ───────────────────────────────────────────────────
    const sheetNames = await listSheets(spreadsheetId);
    console.log(`[ShippingSync] ${sheetNames.length} sheet(s): ${sheetNames.join(", ")}`);

    if (sheetNames.length === 0) {
      const finishedAt = new Date();
      await prisma.shippingSheetSyncRun.update({
        where: { id: syncRun.id },
        data: { status: "COMPLETED", finishedAt, totalRows: 0 },
      });
      return {
        syncRunId: syncRun.id, totalRows: 0, updatedCount: 0,
        noChangeCount: 0, skippedEmptyCount: 0, notFoundCount: 0,
        failedCount: 0, startedAt, finishedAt,
      };
    }

    // ── 3. Process each sheet ────────────────────────────────────────────────
    for (const sheetName of sheetNames) {
      let sheetData;
      try {
        sheetData = await readSheetByName(spreadsheetId, sheetName);
      } catch (err) {
        console.error(`[ShippingSync] failed to read sheet="${sheetName}":`, err);
        continue;
      }

      if (sheetData.rows.length === 0) {
        console.log(`[ShippingSync] sheet="${sheetName}" is empty — skipping`);
        continue;
      }

      const map = buildHeaderMap(sheetData.headers);

      // Verify required columns are present
      const hasSystemId     = H_SYSTEM_ORDER_ID in map;
      const hasErrorMsg     = H_ERROR_MESSAGE in map;
      const hasLastSync     = H_LAST_SHIPPING_SYNC in map;
      const hasAnyShipping  = (H_SHIPPING_STATUS in map) || (H_SHIPPING_COMPANY in map) || (H_TRACKING_NUMBER in map);

      if (!hasSystemId || !hasAnyShipping) {
        console.log(
          `[ShippingSync] sheet="${sheetName}" missing required shipping columns — skipping`
        );
        continue;
      }

      if (!hasErrorMsg || !hasLastSync) {
        console.log(
          `[ShippingSync] sheet="${sheetName}" missing Error Message or Last Shipping Sync columns — skipping`
        );
        continue;
      }

      const errorMsgColIdx     = map[H_ERROR_MESSAGE]!;
      const lastSyncColIdx     = map[H_LAST_SHIPPING_SYNC]!;

      const writeBackEntries: {
        rowIndex: number;
        errorMessage: string;
        lastShippingSync: string;
      }[] = [];

      // ── 4. Process each row ──────────────────────────────────────────────
      for (const row of sheetData.rows) {
        totalRows++;

        const { rowIndex, values } = row;

        // Skip completely empty shipping rows
        if (isShippingRowEmpty(values, map)) {
          skippedEmptyCount++;
          continue;
        }

        const systemOrderId   = getCell(values, map, H_SYSTEM_ORDER_ID);
        const shippingStatus  = getCell(values, map, H_SHIPPING_STATUS);
        const shippingCompany = getCell(values, map, H_SHIPPING_COMPANY);
        const trackingNumber  = getCell(values, map, H_TRACKING_NUMBER);

        // Row has shipping data but no System Order ID
        if (!systemOrderId) {
          failedCount++;
          writeBackEntries.push({
            rowIndex,
            errorMessage: "System Order ID مفقود",
            lastShippingSync: "",
          });
          continue;
        }

        try {
          // ── 5. Find order in DB ────────────────────────────────────────
          const order = await prisma.order.findUnique({
            where: { id: systemOrderId },
            select: {
              id: true,
              statusId: true,
              shippingInfo: {
                select: {
                  id: true,
                  shippingCompanyId: true,
                  trackingNumber: true,
                },
              },
            },
          });

          if (!order) {
            notFoundCount++;
            writeBackEntries.push({
              rowIndex,
              errorMessage: "الطلب غير موجود بالنظام",
              lastShippingSync: "",
            });
            console.log(`[ShippingSync] row ${rowIndex}: order "${systemOrderId}" not found — skipping`);
            continue;
          }

          // ── 6. Compute updates ─────────────────────────────────────────
          let orderStatusUpdate: string | null = null;
          let newCompanyId: string | undefined;
          let newTrackingNumber: string | undefined;

          // Resolve new primary status
          if (shippingStatus) {
            const statusId = statusByName.get(shippingStatus);
            if (statusId && statusId !== order.statusId) {
              orderStatusUpdate = statusId;
            } else if (!statusId) {
              console.warn(
                `[ShippingSync] row ${rowIndex}: shipping status "${shippingStatus}" not found in system`
              );
            }
          }

          // Resolve new shipping company (only if ShippingInfo exists)
          if (shippingCompany && order.shippingInfo) {
            const companyId = companyByName.get(shippingCompany);
            if (companyId && companyId !== order.shippingInfo.shippingCompanyId) {
              newCompanyId = companyId;
            } else if (!companyId) {
              console.warn(
                `[ShippingSync] row ${rowIndex}: shipping company "${shippingCompany}" not found in system`
              );
            }
          }

          // Resolve tracking number (only if ShippingInfo exists)
          if (trackingNumber && order.shippingInfo) {
            const currentTracking = order.shippingInfo.trackingNumber ?? "";
            if (trackingNumber !== currentTracking) {
              newTrackingNumber = trackingNumber;
            }
          }

          const hasShippingInfoChange = newCompanyId !== undefined || newTrackingNumber !== undefined;
          const shippingInfoUpdate: { shippingCompanyId?: string; trackingNumber?: string } | null =
            hasShippingInfoChange
              ? {
                  ...(newCompanyId      !== undefined && { shippingCompanyId: newCompanyId }),
                  ...(newTrackingNumber !== undefined && { trackingNumber: newTrackingNumber }),
                }
              : null;

          const hasChanges = orderStatusUpdate !== null || shippingInfoUpdate !== null;

          if (!hasChanges) {
            noChangeCount++;
            writeBackEntries.push({
              rowIndex,
              errorMessage: "",
              lastShippingSync: "",
            });
            continue;
          }

          // ── 7. Apply updates ───────────────────────────────────────────
          await prisma.$transaction(async (tx) => {
            if (orderStatusUpdate) {
              await tx.order.update({
                where: { id: order.id },
                data: { statusId: orderStatusUpdate },
              });
            }

            if (shippingInfoUpdate && order.shippingInfo) {
              await tx.shippingInfo.update({
                where: { id: order.shippingInfo!.id },
                data: shippingInfoUpdate,
              });
            }

            // Audit log
            await tx.orderAuditLog.create({
              data: {
                orderId:     order.id,
                action:      "SHIPPING_SYNC",
                fieldName:   "shipping",
                oldValue:    null,
                newValue:    JSON.stringify({
                  shippingStatus:  orderStatusUpdate ?? undefined,
                  shippingCompany: shippingInfoUpdate?.shippingCompanyId ?? undefined,
                  trackingNumber:  shippingInfoUpdate?.trackingNumber ?? undefined,
                }),
                changedById: triggeredByUserId,
              },
            });
          });

          updatedCount++;
          const syncDate = formatSyncDate(new Date());
          writeBackEntries.push({
            rowIndex,
            errorMessage: "",
            lastShippingSync: syncDate,
          });

          console.log(`[ShippingSync] row ${rowIndex}: order "${systemOrderId}" updated`);
        } catch (rowErr) {
          failedCount++;
          const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
          console.error(`[ShippingSync] row ${rowIndex}: error — ${msg}`);
          writeBackEntries.push({
            rowIndex,
            errorMessage: `خطأ: ${msg.slice(0, 100)}`,
            lastShippingSync: "",
          });
        }
      }

      // ── 8. Write results back to sheet ─────────────────────────────────
      if (writeBackEntries.length > 0) {
        try {
          await writeShippingResults(
            spreadsheetId,
            sheetName,
            writeBackEntries,
            errorMsgColIdx,
            lastSyncColIdx,
          );
        } catch (writeErr) {
          console.error(`[ShippingSync] failed to write back to sheet="${sheetName}":`, writeErr);
        }
      }
    }

    // ── 9. Save audit activity log ─────────────────────────────────────────
    try {
      await prisma.activityLog.create({
        data: {
          userId:     triggeredByUserId,
          action:     "SHIPPING_SHEET_SYNC",
          entityType: "ShippingSheetSyncRun",
          entityId:   syncRun.id,
          details: {
            totalRows, updatedCount, noChangeCount,
            skippedEmptyCount, notFoundCount, failedCount,
          },
        },
      });
    } catch (logErr) {
      console.warn("[ShippingSync] failed to write activity log:", logErr);
    }

    const finishedAt = new Date();

    await prisma.shippingSheetSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED",
        finishedAt,
        totalRows,
        updatedCount,
        noChangeCount,
        skippedEmptyCount,
        notFoundCount,
        failedCount,
      },
    });

    console.log(
      `[ShippingSync] completed — rows:${totalRows} updated:${updatedCount} ` +
      `noChange:${noChangeCount} empty:${skippedEmptyCount} notFound:${notFoundCount} failed:${failedCount}`
    );

    return {
      syncRunId: syncRun.id,
      totalRows, updatedCount, noChangeCount,
      skippedEmptyCount, notFoundCount, failedCount,
      startedAt, finishedAt,
    };
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error("[ShippingSync] fatal error:", msg);

    await prisma.shippingSheetSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorSummary: msg.slice(0, 500),
        totalRows, updatedCount, noChangeCount,
        skippedEmptyCount, notFoundCount, failedCount,
      },
    });

    throw fatalErr;
  }
}
