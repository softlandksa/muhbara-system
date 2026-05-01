# Deployment Guide

## Required Environment Variables

| Variable | Where to get it | Required |
|---|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → Connection pooling URL | Always |
| `DIRECT_URL` | Supabase → Settings → Database → Direct connection URL | Always |
| `NEXTAUTH_SECRET` | Run: `openssl rand -base64 32` | Always |
| `NEXTAUTH_URL` | Your Vercel deployment URL, e.g. `https://your-app.vercel.app` | Always |
| `BLOB_READ_WRITE_TOKEN` | Vercel Dashboard → Storage → Blob (see below) | Production |

---

## Configuring Vercel Blob (file uploads)

Without `BLOB_READ_WRITE_TOKEN` the receipt upload feature will be unavailable in production.

### Steps

1. Open [vercel.com](https://vercel.com) and navigate to your project.
2. Click the **Storage** tab.
3. Click **Create** → choose **Blob**.
4. Give the store a name (e.g. `order-receipts`) and click **Create**.
5. On the next screen click **Connect to project** and select your project.
6. Vercel will add `BLOB_READ_WRITE_TOKEN` automatically to your project's Environment Variables.
   - Verify: Project → **Settings** → **Environment Variables** → confirm `BLOB_READ_WRITE_TOKEN` exists.
7. If you need the token locally, run:
   ```bash
   vercel env pull .env.local
   ```
   This writes `BLOB_READ_WRITE_TOKEN` (and other Vercel-managed vars) to `.env.local`.

### Redeploy after adding variables

Environment variable changes only take effect after a new deployment:

```bash
# Trigger a fresh deploy via CLI
vercel --prod

# Or push a commit — Vercel will auto-deploy from the connected branch.
git commit --allow-empty -m "chore: trigger redeploy after env var update"
git push
```

---

## Pre-deployment checklist

Run this before every production deploy to catch missing config early:

```bash
NODE_ENV=production npm run check:env
```

Example output when everything is configured:

```
=== Environment Variable Check (production mode) ===

  ✓  DATABASE_URL
  ✓  DIRECT_URL
  ✓  NEXTAUTH_SECRET
  ✓  NEXTAUTH_URL
  ✓  BLOB_READ_WRITE_TOKEN

Environment check passed.
```

---

## Post-deployment health check

After deploying, verify the system is healthy by hitting the admin endpoint:

```
GET /api/admin/health
```

Requires an **ADMIN** session cookie. Returns:

```json
{
  "status": "ok",
  "checks": {
    "database":    { "ok": true, "detail": "connected" },
    "storage":     { "ok": true, "detail": "BLOB_READ_WRITE_TOKEN is set" },
    "environment": { "ok": true, "detail": "all required variables present" }
  }
}
```

If `status` is `"degraded"`, inspect the `checks` object for the failing component.

---

## Database schema changes

When deploying a version that introduced the `PaymentReceipt` table (multi-receipt feature), run:

```bash
# Push schema changes to the database (additive only — no data loss)
npx prisma db push

# Regenerate the Prisma client to pick up the new model
npx prisma generate
```

> **Note:** This project uses `prisma db push` (not `migrate`) because the database was originally provisioned that way. Never run `prisma migrate dev` against the production database — it will prompt to reset and delete all data.

---

## Employee testing checklist

After a successful deploy, ask an employee to verify each scenario:

### Receipt uploads (multi-receipt)
- [ ] Create an order **without** any receipt — order saves successfully
- [ ] Create an order with **1 receipt** (JPEG) — uploads, order saves, receipt visible on detail page
- [ ] Create an order with **1 receipt** (PNG) — same
- [ ] Create an order with **1 receipt** (PDF) — same
- [ ] Add **2 receipts** to one order — both visible and numbered on detail page
- [ ] Add **3 receipts** to one order — all three visible, "إضافة إيصال" button disappears
- [ ] Try adding a **4th receipt** — button is no longer visible (max 3 enforced client-side)
- [ ] Try uploading a file **larger than 10 MB** — rejected with Arabic error message
- [ ] Try uploading an **unsupported file type** (e.g. `.txt`, `.zip`) — rejected with Arabic error message
- [ ] Open order detail — all receipt download links work

### Pagination & bulk selection scope
- [ ] Orders list shows **20 orders per page** (not 25)
- [ ] Navigate to page 2 or later, then click the checkbox in the header — scope dialog appears with three options
- [ ] Select "**هذه الصفحة فقط**" — only visible rows are selected
- [ ] Select "**جميع النتائج المطابقة**" — status bar shows total matching count, not page count
- [ ] Select "**تحديد عدد معين**" — input accepts a number, selection count updates
- [ ] Bulk status change with scope "جميع النتائج المطابقة" — updates all matching orders, not just the current page
- [ ] Bulk delete (ADMIN only) with scope dialog — correct count shown in confirmation

### Employee filter (managers/admins)
- [ ] As ADMIN or GENERAL_MANAGER: filter panel shows "الموظف" dropdown with all sales employees
- [ ] As SALES_MANAGER: filter panel shows only employees in their own team
- [ ] Selecting an employee filters orders to that employee only
- [ ] Employee filter combines correctly with date, status, and country filters
- [ ] Clearing filters resets the employee filter

### Layout
- [ ] Arabic RTL layout is intact throughout all forms and tables

---

---

## Google Sheets automatic order import

### Required environment variables

| Variable | Description | Required |
|---|---|---|
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Service account email from Google Cloud | Yes |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Private key from the service account JSON (keep `\n` escapes) | Yes |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | The spreadsheet ID from the sheet URL | Yes |
| `GOOGLE_SHEETS_SHEET_NAME` | The exact tab name inside the spreadsheet | Yes |
| `GOOGLE_SHEETS_RANGE` | Override read range, e.g. `Sheet1!A:Z` (optional, defaults to `SheetName!A:Z`) | No |
| `GOOGLE_SHEETS_SYNC_SECRET` | Secret token to protect the cron endpoint | Yes (production) |

### Google Cloud setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create (or select) a project.
2. Enable the **Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable.
3. Create a service account: IAM & Admin → Service Accounts → Create Service Account.
   - Give it any name (e.g. `sheets-importer`).
   - No special IAM roles needed.
4. Generate a JSON key: click the service account → Keys → Add Key → JSON → Download.
5. From the JSON file, copy:
   - `client_email` → `GOOGLE_SHEETS_CLIENT_EMAIL`
   - `private_key` → `GOOGLE_SHEETS_PRIVATE_KEY` (the full `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` string)

### Share the spreadsheet with the service account

Open the Google Sheet → Share → paste the `GOOGLE_SHEETS_CLIENT_EMAIL` value → **Editor** role → Share.

### Sheet column template

The sheet must have a header row with **exactly** these column names (case-sensitive):

| Column | Required | Notes |
|---|---|---|
| External Order ID | Yes | Unique key — never duplicated |
| Order Date | Yes | ISO `YYYY-MM-DD`, `DD/MM/YYYY`, or Excel serial |
| Customer Name | Yes | |
| Phone | Yes | |
| Country | Yes | Must match a country name/code in the system |
| City | No | Combined with Detailed Address |
| Detailed Address | No | |
| Product | Yes | Must match a product name or SKU in the system |
| Quantity | Yes | Positive integer |
| Paid Amount | Yes | Non-negative decimal |
| Currency | Yes | Must match currency name or ISO code (e.g. SAR, USD) |
| Payment Method | Yes | Must match a payment method name in the system |
| Receipt URL 1 | No | Must be an http/https URL |
| Receipt URL 2 | No | |
| Receipt URL 3 | No | |
| Notes | No | |
| Employee Email | Yes | Must match an active user's email |
| Sync Status | Yes | System-written: empty → Synced / Failed |
| System Order ID | Yes | System-written: filled with the order number |
| Error Message | Yes | System-written: filled on failure |

> **Sync Status**, **System Order ID**, and **Error Message** must exist as columns even if empty — the system writes back to these columns after each sync.

### Setting GOOGLE_SHEETS_PRIVATE_KEY in Vercel

The private key contains literal `\n` newlines. In Vercel Dashboard → Settings → Environment Variables, paste the raw multi-line private key directly into the value field (Vercel stores it correctly). Do **not** manually add `\n` — Vercel handles multiline values.

If setting via `.env.local`, keep the `\n` literal escapes:
```
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv....\n-----END PRIVATE KEY-----\n"
```

### Vercel Cron setup (every 12 hours)

The `vercel.json` at the project root configures the cron:
```json
{
  "crons": [{ "path": "/api/cron/google-sheets-sync", "schedule": "0 */12 * * *" }]
}
```

Vercel automatically sets `CRON_SECRET` and sends it as `Authorization: Bearer <secret>` to the cron endpoint. Set `GOOGLE_SHEETS_SYNC_SECRET` to the same value in your environment variables, or rely on Vercel's built-in `CRON_SECRET`.

To add `GOOGLE_SHEETS_SYNC_SECRET`:
```bash
openssl rand -hex 32
# Paste the output into Vercel → Environment Variables → GOOGLE_SHEETS_SYNC_SECRET
```

### Manual sync

Roles that can trigger manual sync: **مدير النظام** (ADMIN), **مدير عام** (GENERAL_MANAGER), **موظف شحن** (SHIPPING).

The "تحديث البيانات" button appears at the top of the Orders page for these roles. Clicking it triggers the same import process as the cron job. The last sync time is shown next to the button.

### Database schema update

After pulling this update, push the new models to the database:
```bash
npx prisma db push
npx prisma generate
```

This adds `GoogleSheetImportLog` and `GoogleSheetSyncRun` tables (additive only — no data loss).

---

## Local development without Vercel Blob

Omit `BLOB_READ_WRITE_TOKEN` from `.env`. The app automatically falls back to local
filesystem storage (`./uploads/`) in development mode.

**Never** commit `.env` or `.env.local` files — they are listed in `.gitignore`.
