const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LTR = "‎"; // U+200E LEFT-TO-RIGHT MARK — prevents RTL bidi reordering of date segments

const MONTH_MAP: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

/**
 * Formats a calendar date as D-MMM-YYYY (e.g. "3-May-2026", "22-Apr-2026").
 *
 * Uses UTC date parts so an orderDate stored as UTC midnight is never
 * shifted when the client is in a non-UTC timezone.
 *
 * Accepts a `fallback` (e.g. createdAt) that is used when `date` is absent.
 */
export function formatOrderDate(
  date: Date | string | null | undefined,
  fallback?: Date | string | null,
): string {
  const src = date ?? fallback;
  if (!src) return "";
  try {
    if (typeof src === "string") {
      // API string — stored as UTC midnight, use UTC accessors to avoid day shift
      const d = new Date(src);
      if (isNaN(d.getTime())) return "";
      return `${LTR}${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
    } else {
      // Date object from picker — already in local midnight, use local accessors
      if (isNaN(src.getTime())) return "";
      return `${LTR}${src.getDate()}-${MONTHS[src.getMonth()]}-${src.getFullYear()}`;
    }
  } catch { return ""; }
}

/**
 * Formats a system timestamp as D-MMM-YYYY h:mm A (e.g. "3-May-2026 2:30 PM").
 *
 * Uses local time getters so createdAt / shippedAt / audit timestamps appear
 * in the browser's (or server's) local timezone.
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    const day   = d.getDate();
    const month = MONTHS[d.getMonth()];
    const year  = d.getFullYear();
    const h     = d.getHours();
    const m     = d.getMinutes().toString().padStart(2, "0");
    const ampm  = h >= 12 ? "PM" : "AM";
    const h12   = h % 12 || 12;
    return `${LTR}${day}-${month}-${year} ${h12}:${m} ${ampm}`;
  } catch { return ""; }
}

/**
 * Parses order date strings from Google Sheets (and other external sources)
 * into a UTC-midnight Date to avoid timezone shifting on storage.
 *
 * Supported formats (case-insensitive month abbreviation):
 *   D-MMM-YYYY / DD-MMM-YYYY  →  3-May-2026, 22-Apr-2026
 *   YYYY-MM-DD                →  2026-05-03
 *   D/M/YYYY or D-M-YYYY     →  3/5/2026, 22-4-2026
 *   Excel serial              →  46214
 *
 * Returns null for empty, unrecognised, or out-of-range values.
 */
export function parseSheetOrderDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();

  // D-MMM-YYYY / DD-MMM-YYYY  (primary Google Sheets format)
  const named = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (named) {
    const day   = parseInt(named[1]!, 10);
    const month = MONTH_MAP[named[2]!.toLowerCase()];
    const year  = parseInt(named[3]!, 10);
    if (month === undefined || day < 1 || day > 31 || year < 1900) {
      console.warn(`[parseSheetOrderDate] invalid named-month date: "${s}"`);
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

  // D/M/YYYY or D-M-YYYY (numeric day and month — not a named month)
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

  console.warn(`[parseSheetOrderDate] unrecognised format: "${s}"`);
  return null;
}
