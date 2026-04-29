This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

### Required environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Pooled Postgres connection string (PgBouncer) |
| `DIRECT_URL` | ✅ | Direct Postgres connection (used by Prisma migrations) |
| `NEXTAUTH_SECRET` | ✅ | Random secret — generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | Full production URL, e.g. `https://your-app.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob token — **required for file uploads in production** |

### Setting up Vercel Blob (file uploads)

Payment receipt uploads use [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) as the storage provider.
The local filesystem cannot be used on Vercel (Lambda FS is read-only).

1. Open your Vercel project → **Storage** tab → **Create** → **Blob**
2. Name the store (e.g. `order-receipts`) and click **Create**
3. Go to **Settings** → **Connect Project** and link it to your deployment
4. Vercel automatically adds `BLOB_READ_WRITE_TOKEN` to your project's environment variables
5. Redeploy — uploads will now work

### Local development

In local development, `BLOB_READ_WRITE_TOKEN` is not required.
When the variable is absent and `NODE_ENV` is not `production`, uploaded files are saved to `./uploads/` instead.
That directory is git-ignored and must never be deployed.
