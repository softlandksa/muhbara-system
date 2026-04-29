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

## Employee testing checklist

After a successful deploy, ask an employee to verify each scenario:

- [ ] Create an order **without** a receipt — order saves successfully
- [ ] Create an order **with** a JPEG image receipt — uploads and order saves
- [ ] Create an order **with** a PNG image receipt — uploads and order saves
- [ ] Create an order **with** a PDF receipt — uploads and order saves
- [ ] Try uploading a file larger than 10 MB — rejected with Arabic error message
- [ ] Try uploading an unsupported file type (e.g. `.txt`, `.zip`) — rejected with Arabic error message
- [ ] View order detail — receipt download link works
- [ ] Arabic RTL layout is intact throughout the form

---

## Local development without Vercel Blob

Omit `BLOB_READ_WRITE_TOKEN` from `.env`. The app automatically falls back to local
filesystem storage (`./uploads/`) in development mode.

**Never** commit `.env` or `.env.local` files — they are listed in `.gitignore`.
