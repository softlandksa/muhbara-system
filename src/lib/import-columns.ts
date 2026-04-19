/**
 * Single source of truth for Excel import/export column definitions.
 * Both /api/orders/import (parser) and /api/orders/template (generator)
 * import from here so headers can never drift apart.
 */

export const IMPORT_COLUMNS = [
  {
    header: "اسم العميل",
    key: "اسم العميل",
    required: true,
    width: 22,
    note: "الاسم الكامل للعميل (مطلوب)",
  },
  {
    header: "الجوال",
    key: "الجوال",
    required: true,
    width: 16,
    note: "رقم الجوال بدون صفر في البداية — مثال: 501234567 (مطلوب)",
  },
  {
    header: "العنوان",
    key: "العنوان",
    required: true,
    width: 32,
    note: "المدينة والحي والشارع (مطلوب)",
  },
  {
    header: "الدولة",
    key: "الدولة",
    required: true,
    width: 18,
    note: "اختر من القائمة المنسدلة (مطلوب)",
  },
  {
    header: "العملة",
    key: "العملة",
    required: true,
    width: 12,
    note: "رمز العملة — اختر من القائمة المنسدلة (مطلوب)",
  },
  {
    header: "طريقة الدفع",
    key: "طريقة الدفع",
    required: true,
    width: 22,
    note: "اختر من القائمة المنسدلة (مطلوب)",
  },
  {
    header: "المنتج",
    key: "المنتج",
    required: true,
    width: 28,
    note: "اسم المنتج — اختر من القائمة المنسدلة (مطلوب)",
  },
  {
    header: "الكمية",
    key: "الكمية",
    required: true,
    width: 10,
    note: "رقم صحيح أكبر من أو يساوي 1 (افتراضي: 1)",
  },
  {
    header: "السعر",
    key: "السعر",
    required: true,
    width: 12,
    note: "سعر الوحدة بالعملة المختارة (افتراضي: 0)",
  },
  {
    header: "الموظف المسؤول (البريد الإلكتروني)",
    key: "الموظف المسؤول (البريد الإلكتروني)",
    required: false,
    width: 36,
    note: "البريد الإلكتروني للموظف المسؤول (اختياري — يُترك فارغاً ليُسجَّل باسمك)",
  },
  {
    header: "ملاحظات",
    key: "ملاحظات",
    required: false,
    width: 30,
    note: "ملاحظات إضافية (اختياري)",
  },
] as const;

/** The 9 columns that MUST be present in every uploaded file */
export const REQUIRED_IMPORT_HEADERS = IMPORT_COLUMNS.filter((c) => c.required).map(
  (c) => c.header
) as string[];

/** Name of the main data sheet inside the generated template */
export const IMPORT_SHEET_NAME = "الطلبات";

/**
 * Normalise a raw cell string read from xlsx:
 * - strip leading UTF-8 BOM (U+FEFF) that Excel sometimes prepends to the first cell
 * - collapse multiple whitespace runs to a single space
 * - trim
 */
export function normaliseHeader(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")   // BOM
    .replace(/\s+/g, " ")     // collapse whitespace
    .trim();
}

/**
 * Given a parsed xlsx workbook's sheet list, return the best sheet to use:
 * 1. Sheet named exactly IMPORT_SHEET_NAME ("الطلبات")
 * 2. First sheet whose first row contains the most required header matches
 * 3. First sheet as last resort
 */
export function pickDataSheet(
  sheetNames: string[],
  getRows: (name: string) => unknown[][]
): string {
  // 1. Exact name match
  const exact = sheetNames.find((n) => n === IMPORT_SHEET_NAME);
  if (exact) return exact;

  // 2. Best header match
  let bestName = sheetNames[0];
  let bestScore = -1;
  for (const name of sheetNames) {
    const rows = getRows(name);
    const first = (rows[0] ?? []).map(normaliseHeader);
    const score = REQUIRED_IMPORT_HEADERS.filter((h) => first.includes(h)).length;
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }
  return bestName;
}
