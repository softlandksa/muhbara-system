const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parses order date strings into a UTC-midnight Date to avoid timezone shifting.
 *
 * Supported formats (case-insensitive month):
 *   D-MMM-YYYY / DD-MMM-YYYY  → 3-May-2026, 22-Apr-2026
 *   YYYY-MM-DD                → 2026-05-03
 *   D/M/YYYY or D-M-YYYY     → 3/5/2026, 22-4-2026
 *   Excel serial              → 46214
 *
 * Returns null for empty, unrecognised, or out-of-range values.
 */
export function parseOrderDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();

  // D-MMM-YYYY / DD-MMM-YYYY  (primary format from Google Sheets)
  const named = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (named) {
    const day   = parseInt(named[1]!, 10);
    const month = MONTH_MAP[named[2]!.toLowerCase()];
    const year  = parseInt(named[3]!, 10);
    if (month === undefined || day < 1 || day > 31 || year < 1900) {
      console.warn(`[parseOrderDate] invalid named-month date: "${s}"`);
      return null;
    }
    return new Date(Date.UTC(year, month, day));
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    return isNaN(date.getTime()) ? null : date;
  }

  // D/M/YYYY or D-M-YYYY (numeric day and month, NOT a named month)
  const numeric = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (numeric) {
    const date = new Date(Date.UTC(
      parseInt(numeric[3]!, 10),
      parseInt(numeric[2]!, 10) - 1,
      parseInt(numeric[1]!, 10),
    ));
    return isNaN(date.getTime()) ? null : date;
  }

  // Excel serial date (Lotus/Windows epoch: 1899-12-30)
  const serial = Number(s);
  if (!isNaN(serial) && serial > 1000 && serial < 2958466) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  }

  console.warn(`[parseOrderDate] unrecognised date format: "${s}"`);
  return null;
}

/**
 * Formats a date as D-MMM-YYYY (e.g. 22-Apr-2026, 3-May-2026).
 *
 * Uses UTC date parts to avoid client-timezone shifting when the date was
 * stored as UTC midnight (as parseOrderDate produces).
 *
 * Falls back to createdAt representation only when orderDate is absent.
 */
export function formatOrderDate(
  orderDate: Date | string | null | undefined,
  fallback?: Date | string | null,
): string {
  const source = orderDate ?? fallback;
  if (!source) return "";
  try {
    const d = typeof source === "string" ? new Date(source) : source;
    if (isNaN(d.getTime())) return "";
    const day   = d.getUTCDate();
    const month = MONTH_ABBR[d.getUTCMonth()];
    const year  = d.getUTCFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return "";
  }
}
