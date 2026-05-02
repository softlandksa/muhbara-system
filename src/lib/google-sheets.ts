import { JWT } from "google-auth-library";

// ── Module-level OAuth token cache (valid for 50 min within a single invocation) ──
let _cachedToken: { value: string; expiresAt: number } | null = null;

function createAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  console.log("[google-sheets] createAuth ENV CHECK", {
    hasClientEmail: !!clientEmail,
    hasPrivateKey: !!rawKey,
  });
  if (!clientEmail || !rawKey) {
    throw new Error(
      "إعدادات Google Sheets غير مكتملة: GOOGLE_SHEETS_CLIENT_EMAIL أو GOOGLE_SHEETS_PRIVATE_KEY مفقود"
    );
  }

  // Support both actual newlines and escaped \n (Vercel stores secrets with \n)
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const keyIsValid =
    privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    privateKey.includes("-----BEGIN RSA PRIVATE KEY-----");

  console.log("GOOGLE_SYNC_PRIVATE_KEY_FORMAT_OK", keyIsValid, {
    length: privateKey.length,
    hasBeginMarker: privateKey.includes("-----BEGIN"),
    hasEndMarker: privateKey.includes("-----END"),
  });

  if (!keyIsValid) {
    throw new Error(
      "PRIVATE_KEY_FORMAT_ERROR: تنسيق GOOGLE_SHEETS_PRIVATE_KEY غير صحيح — يجب أن يبدأ بـ -----BEGIN PRIVATE KEY-----"
    );
  }

  console.log("GOOGLE_SYNC_CLIENT_INIT_OK");
  return new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now) {
    return _cachedToken.value;
  }

  console.log("[google-sheets] requesting OAuth token for service account...");
  const auth = createAuth();
  let token: string | null | undefined;
  try {
    const response = await auth.getAccessToken();
    token = response.token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google-sheets] OAuth token request failed:", msg);
    throw new Error(`فشل الحصول على رمز OAuth من Google: ${msg}`);
  }
  if (!token) {
    throw new Error("فشل الحصول على رمز OAuth من Google: الرمز فارغ");
  }
  console.log("[google-sheets] OAuth token obtained successfully");
  _cachedToken = { value: token, expiresAt: now + 50 * 60 * 1000 };
  return token;
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

/**
 * Lists all sheet/tab names in the workbook, in their display order.
 */
export async function listSheets(spreadsheetId: string): Promise<string[]> {
  const token = await getAccessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?fields=sheets.properties.title`;

  console.log(`[google-sheets] listing sheets in spreadsheet="${spreadsheetId}"`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(
      `[google-sheets] list sheets failed — HTTP ${res.status}: ${body.slice(0, 400)}`
    );
    throw new Error(
      `فشل قراءة قائمة الأوراق من Google Sheets (${res.status}): ${body.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as {
    sheets?: { properties?: { title?: string } }[];
  };
  const names = (json.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter(Boolean);

  console.log("GOOGLE_SYNC_SHEETS_LIST_OK", names.length, names.join(", "));
  return names;
}

/**
 * Reads all rows from a specific sheet/tab by name.
 *
 * `columnRange` defaults to the GOOGLE_SHEETS_RANGE env var or "A:Z".
 * Any sheet-name prefix in that env var (e.g. "Sheet1!A:S") is stripped automatically
 * so only the column range ("A:S") is used.
 */
export async function readSheetByName(
  spreadsheetId: string,
  sheetName: string,
  columnRange?: string
): Promise<SheetData> {
  const col = columnRange ?? process.env.GOOGLE_SHEETS_RANGE ?? "A:Z";
  // Strip any leading "SheetName!" prefix so GOOGLE_SHEETS_RANGE can be either
  // "A:T" (new style) or "Sheet1!A:T" (old style) without breaking.
  const cleanCol = col.includes("!") ? col.split("!").slice(1).join("!") : col;
  const readRange = `${quoteSheetName(sheetName)}!${cleanCol}`;

  console.log(
    `[google-sheets] reading spreadsheet="${spreadsheetId}" sheet="${sheetName}" range="${readRange}"`
  );

  const token = await getAccessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/` +
    `${encodeURIComponent(readRange)}?valueRenderOption=UNFORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(
      `[google-sheets] read failed — sheet="${sheetName}" HTTP ${res.status}: ${body.slice(0, 400)}`
    );
    throw new Error(
      `فشل قراءة الورقة "${sheetName}" من Google Sheets (${res.status}): ${body.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as { values?: unknown[][] };
  const rawValues = json.values ?? [];

  console.log(
    `[google-sheets] sheet="${sheetName}" — total rows (including header): ${rawValues.length}`
  );

  if (rawValues.length === 0) {
    return { spreadsheetId, sheetName, headers: [], rows: [] };
  }

  const headers = (rawValues[0] ?? []).map((h) => String(h ?? "").trim());
  console.log(
    `[google-sheets] sheet="${sheetName}" headers (${headers.length}): ${headers.join(" | ")}`
  );

  const rows: SheetRow[] = [];
  for (let i = 1; i < rawValues.length; i++) {
    const rawRow = rawValues[i] ?? [];
    const values: string[] = Array.from({ length: headers.length }, (_, j) =>
      String(rawRow[j] ?? "").trim()
    );
    rows.push({ rowIndex: i + 1, values });
  }

  console.log(
    `[google-sheets] sheet="${sheetName}" — data rows (excluding header): ${rows.length}`
  );
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

  console.log(
    `[google-sheets] writing back ${entries.length} row(s) to sheet="${sheetName}" — ` +
    `syncStatus col=${syncStatusColIdx} systemOrderId col=${systemOrderIdColIdx} errorMessage col=${errorMessageColIdx}`
  );

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
    console.log(
      `[google-sheets] batch update chunk ${Math.floor(i / BATCH_SIZE) + 1} — ${batch.length} ranges`
    );
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
      console.error(
        `[google-sheets] batch update failed — HTTP ${res.status}: ${body.slice(0, 400)}`
      );
      throw new Error(`فشل تحديث Google Sheets (${res.status}): ${body.slice(0, 200)}`);
    }
    console.log(`[google-sheets] batch update chunk OK`);
  }

  console.log(`[google-sheets] all write-back chunks completed for sheet="${sheetName}"`);
}
