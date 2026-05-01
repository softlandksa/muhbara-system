import { JWT } from "google-auth-library";

function createAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!clientEmail || !rawKey) {
    throw new Error(
      "إعدادات Google Sheets غير مكتملة: GOOGLE_SHEETS_CLIENT_EMAIL أو GOOGLE_SHEETS_PRIVATE_KEY مفقود"
    );
  }
  return new JWT({
    email: clientEmail,
    key: rawKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getAccessToken(): Promise<string> {
  const tokenResponse = await createAuth().getAccessToken();
  if (!tokenResponse.token) throw new Error("فشل الحصول على رمز OAuth من Google");
  return tokenResponse.token;
}

/** Wraps a sheet name with single-quotes when it contains spaces or special chars. */
function quoteSheetName(name: string): string {
  return /[\s'!:]/.test(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

/** Converts a 0-based column index to an A1 letter (0→A, 25→Z, 26→AA …). */
export function colIndexToA1(col: number): string {
  let letter = "";
  let idx = col + 1;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    idx = Math.floor((idx - 1) / 26);
  }
  return letter;
}

export type SheetRow = {
  /** 1-based sheet row number (header = 1, first data row = 2). */
  rowIndex: number;
  values: string[];
};

export type SheetData = {
  spreadsheetId: string;
  sheetName: string;
  headers: string[];
  rows: SheetRow[];
};

export type WriteBackEntry = {
  rowIndex: number;
  syncStatus: string;
  systemOrderId: string;
  errorMessage: string;
};

/** Reads all rows from the configured Google Sheet. */
export async function readSheet(): Promise<SheetData> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID غير مكوّن");
  if (!sheetName) throw new Error("GOOGLE_SHEETS_SHEET_NAME غير مكوّن");

  const readRange =
    process.env.GOOGLE_SHEETS_RANGE ??
    `${quoteSheetName(sheetName)}!A:Z`;

  const token = await getAccessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/` +
    `${encodeURIComponent(readRange)}?valueRenderOption=UNFORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`فشل قراءة Google Sheets (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { values?: unknown[][] };
  const rawValues = json.values ?? [];

  if (rawValues.length === 0) {
    return { spreadsheetId, sheetName, headers: [], rows: [] };
  }

  const headers = (rawValues[0] ?? []).map((h) => String(h ?? "").trim());
  const rows: SheetRow[] = [];

  for (let i = 1; i < rawValues.length; i++) {
    const rawRow = rawValues[i] ?? [];
    const values: string[] = Array.from({ length: headers.length }, (_, j) =>
      String(rawRow[j] ?? "").trim()
    );
    rows.push({ rowIndex: i + 1, values });
  }

  return { spreadsheetId, sheetName, headers, rows };
}

/**
 * Batch-writes Sync Status / System Order ID / Error Message back to the sheet.
 * Uses the actual column indices parsed from the header row.
 */
export async function writeSheetResults(
  spreadsheetId: string,
  sheetName: string,
  entries: WriteBackEntry[],
  syncStatusColIdx: number,
  systemOrderIdColIdx: number,
  errorMessageColIdx: number
): Promise<void> {
  if (entries.length === 0) return;

  const token = await getAccessToken();
  const quotedName = quoteSheetName(sheetName);

  const minCol = Math.min(syncStatusColIdx, systemOrderIdColIdx, errorMessageColIdx);
  const maxCol = Math.max(syncStatusColIdx, systemOrderIdColIdx, errorMessageColIdx);
  const startLetter = colIndexToA1(minCol);
  const endLetter = colIndexToA1(maxCol);

  const data = entries.map((entry) => {
    const rowData = new Array(maxCol - minCol + 1).fill("");
    rowData[syncStatusColIdx - minCol] = entry.syncStatus;
    rowData[systemOrderIdColIdx - minCol] = entry.systemOrderId;
    rowData[errorMessageColIdx - minCol] = entry.errorMessage;
    return {
      range: `${quotedName}!${startLetter}${entry.rowIndex}:${endLetter}${entry.rowIndex}`,
      values: [rowData],
    };
  });

  // Chunk at 500 items to stay well under the API limit of 1 000 ranges per call.
  const BATCH_SIZE = 500;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ valueInputOption: "RAW", data: batch }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`فشل تحديث Google Sheets (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
