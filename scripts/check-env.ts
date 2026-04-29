/**
 * Pre-deployment environment variable validator.
 * Run with: npm run check:env
 *
 * Exits with code 1 if any required variable is missing,
 * so it can block a CI pipeline before a bad deploy ships.
 */

// Load .env / .env.local when running locally.
// In Vercel/CI the variables are injected directly, so this is a no-op there.
import "dotenv/config";

const isProd =
  process.env.NODE_ENV === "production" || process.argv.includes("--production");

type EnvVar = {
  name: string;
  description: string;
  prodOnly?: boolean;
};

const REQUIRED: EnvVar[] = [
  {
    name: "DATABASE_URL",
    description: "PostgreSQL pooled connection URL (runtime)",
  },
  {
    name: "DIRECT_URL",
    description: "PostgreSQL direct connection URL (Prisma migrations)",
  },
  {
    name: "NEXTAUTH_SECRET",
    description: "NextAuth.js secret — generate with: openssl rand -base64 32",
  },
  {
    name: "NEXTAUTH_URL",
    description: "Canonical application URL (e.g. https://your-app.vercel.app)",
  },
  {
    name: "BLOB_READ_WRITE_TOKEN",
    description:
      "Vercel Blob token — Vercel Dashboard → Storage → Blob → .env.local",
    prodOnly: true,
  },
];

const PASS = "  ✓";
const FAIL = "  ✗";
const WARN = "  ⚠";

console.log(
  `\n=== Environment Variable Check (${isProd ? "production" : "development"} mode) ===\n`
);

let failed = false;

for (const { name, description, prodOnly } of REQUIRED) {
  const value = process.env[name];

  if (prodOnly && !isProd) {
    if (!value) {
      console.log(`${WARN}  ${name} — not set (OK in development)`);
    } else {
      console.log(`${PASS}  ${name}`);
    }
    continue;
  }

  if (!value) {
    console.error(`${FAIL}  ${name} — MISSING\n       ${description}`);
    failed = true;
  } else {
    console.log(`${PASS}  ${name}`);
  }
}

console.log();

if (failed) {
  console.error(
    "Environment check FAILED. Add the missing variables before deploying.\n" +
      "See DEPLOYMENT.md for setup instructions.\n"
  );
  process.exit(1);
} else {
  console.log("Environment check passed.\n");
}
