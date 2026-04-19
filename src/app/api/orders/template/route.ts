import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IMPORT_COLUMNS, IMPORT_SHEET_NAME } from "@/lib/import-columns";

// Reference sheet names (hidden, used for data-validation formulae)
const REF = {
  countries:      "Ref_Countries",
  currencies:     "Ref_Currencies",
  paymentMethods: "Ref_PaymentMethods",
  products:       "Ref_Products",
  employees:      "Ref_Employees",
} as const;

// Convert 1-based column index to Excel column letter(s) (A, B, … Z, AA, …)
function colLetter(index: number): string {
  let result = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const [countries, currencies, paymentMethods, products, employees] = await Promise.all([
    prisma.country.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    prisma.currency.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.paymentMethod.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { name: true, sku: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة الطلبات";
  wb.created = new Date();

  // ── IMPORTANT: main data sheet MUST be first in the workbook so that
  //    parsers reading SheetNames[0] land on the correct sheet. ─────────────────
  const ws = wb.addWorksheet(IMPORT_SHEET_NAME, {
    views: [{ rightToLeft: true }],
    properties: { defaultColWidth: 18 },
  });

  // ── Row 1: Headers (bold + coloured background) ───────────────────────────────
  const headerRow = ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  headerRow.height = 26;

  // Add instructions as cell notes (hover tooltips) — no extra data row that
  // would confuse the import parser.
  IMPORT_COLUMNS.forEach((col, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.note = {
      texts: [{ font: { size: 9, bold: false }, text: col.note }],
    };
  });

  // Freeze only row 1
  ws.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];

  // Column widths
  IMPORT_COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  // ── Helper: build a hidden reference sheet ────────────────────────────────────
  // Reference sheets are added AFTER the main sheet to ensure SheetNames[0] = "الطلبات"
  function addRefSheet(sheetName: string, rows: string[][], colWidths: number[]) {
    const ref = wb.addWorksheet(sheetName, { state: "veryHidden" });
    ref.properties.defaultColWidth = 20;
    rows.forEach((row) => ref.addRow(row));
    colWidths.forEach((w, i) => { ref.getColumn(i + 1).width = w; });
    return ref;
  }

  addRefSheet(REF.countries,      countries.map((c) => [c.name]),            [22]);
  addRefSheet(REF.currencies,     currencies.map((c) => [c.code]),            [12]);
  addRefSheet(REF.paymentMethods, paymentMethods.map((p) => [p.name]),        [25]);
  addRefSheet(REF.products,       products.map((p) => [p.name]),              [35]);
  addRefSheet(REF.employees,      employees.map((u) => [u.email, u.name]),    [35, 25]);

  // ── Data validation (rows 2 → 1001, 1000 data rows max) ──────────────────────
  const DATA_START = 2;
  const DATA_END   = 1001;

  const maxRef = Math.max(
    countries.length, currencies.length, paymentMethods.length,
    products.length, employees.length, 1
  );
  const refLastRow = maxRef + 2;

  function colIdx(header: string): number {
    return IMPORT_COLUMNS.findIndex((c) => c.header === header) + 1;
  }

  // Country
  for (let r = DATA_START; r <= DATA_END; r++) {
    ws.getCell(r, colIdx("الدولة")).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`${REF.countries}!$A$1:$A$${refLastRow}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "قيمة غير صالحة",
      error: "يرجى اختيار الدولة من القائمة",
    };
  }

  // Currency
  for (let r = DATA_START; r <= DATA_END; r++) {
    ws.getCell(r, colIdx("العملة")).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`${REF.currencies}!$A$1:$A$${refLastRow}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "قيمة غير صالحة",
      error: "يرجى اختيار العملة من القائمة",
    };
  }

  // Payment method
  for (let r = DATA_START; r <= DATA_END; r++) {
    ws.getCell(r, colIdx("طريقة الدفع")).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`${REF.paymentMethods}!$A$1:$A$${refLastRow}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "قيمة غير صالحة",
      error: "يرجى اختيار طريقة الدفع من القائمة",
    };
  }

  // Product
  for (let r = DATA_START; r <= DATA_END; r++) {
    ws.getCell(r, colIdx("المنتج")).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`${REF.products}!$A$1:$A$${refLastRow}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "قيمة غير صالحة",
      error: "يرجى اختيار المنتج من القائمة",
    };
  }

  // Quantity — whole number ≥ 1
  for (let r = DATA_START; r <= DATA_END; r++) {
    ws.getCell(r, colIdx("الكمية")).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      formulae: [1],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "كمية غير صالحة",
      error: "يجب أن تكون الكمية رقماً صحيحاً ≥ 1",
    };
  }

  // Price — decimal ≥ 0
  for (let r = DATA_START; r <= DATA_END; r++) {
    ws.getCell(r, colIdx("السعر")).dataValidation = {
      type: "decimal",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      formulae: [0],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "سعر غير صالح",
      error: "يجب أن يكون السعر رقماً موجباً أو صفراً",
    };
  }

  // Employee email (optional)
  if (employees.length > 0) {
    for (let r = DATA_START; r <= DATA_END; r++) {
      ws.getCell(r, colIdx("الموظف المسؤول (البريد الإلكتروني)")).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`${REF.employees}!$A$1:$A$${employees.length + 2}`],
        showErrorMessage: false,
      };
    }
  }

  // ── Conditional formatting: highlight empty required-column cells ─────────────
  const requiredHeaders = ["اسم العميل", "الجوال", "العنوان", "الدولة", "العملة", "طريقة الدفع", "المنتج"];
  for (const h of requiredHeaders) {
    const idx = colIdx(h);
    const letter = colLetter(idx);
    ws.addConditionalFormatting({
      ref: `${letter}${DATA_START}:${letter}${DATA_END}`,
      rules: [
        {
          type: "expression",
          formulae: [`AND(ROW()>1,${letter}${DATA_START}="")`],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF3CD" } } },
          priority: 1,
        },
      ],
    });
  }

  const excelBuffer = await wb.xlsx.writeBuffer();

  return new Response(excelBuffer as unknown as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("نموذج_استيراد_الطلبات.xlsx")}`,
    },
  });
}
