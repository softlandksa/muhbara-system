export async function GET() {
  return Response.json({
    hasServiceAccountJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    hasClientEmail:        !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    hasPrivateKey:         !!process.env.GOOGLE_SHEETS_PRIVATE_KEY,
    hasSpreadsheetId:      !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    hasRange:              !!process.env.GOOGLE_SHEETS_RANGE,
    hasSyncSecret:         !!process.env.GOOGLE_SHEETS_SYNC_SECRET,
  });
}
