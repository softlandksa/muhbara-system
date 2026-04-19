/**
 * Migration: Unify OrderStatus enum + ShippingStatus into one table.
 * Run with:  node prisma/migrate-to-unified-status.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const STATUSES = [
  { name: "جاهز للشحن",             color: "#3b82f6", sortOrder: 1 },
  { name: "تم اصدار بوليصة",         color: "#f97316", sortOrder: 2 },
  { name: "تم تسليمه لشركة الشحن",   color: "#eab308", sortOrder: 3 },
  { name: "في الطريق",              color: "#8b5cf6", sortOrder: 4 },
  { name: "تم التوصيل",             color: "#10b981", sortOrder: 5 },
  { name: "مرتجع",                  color: "#ef4444", sortOrder: 6 },
  { name: "ملغي",                   color: "#6b7280", sortOrder: 7 },
];

const ENUM_TO_STATUS = {
  READY_TO_SHIP: "جاهز للشحن",
  SHIPPED:       "تم تسليمه لشركة الشحن",
  DELIVERED:     "تم التوصيل",
  RETURNED:      "مرتجع",
  CANCELLED:     "ملغي",
};

async function main() {
  // 1. Upsert ShippingStatus records
  console.log("Step 1: Upsert ShippingStatus records...");
  for (const s of STATUSES) {
    await prisma.shippingStatus.upsert({
      where: { name: s.name },
      create: s,
      update: { color: s.color, sortOrder: s.sortOrder },
    });
  }
  console.log(`  ✓ ${STATUSES.length} statuses ready`);

  // 2. Add statusId column to Order (nullable)
  console.log("Step 2: Add Order.statusId column...");
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "statusId" TEXT`
  );
  console.log("  ✓ column added");

  // 3. Populate Order.statusId from old enum
  console.log("Step 3: Populate statusId from old status enum...");
  for (const [enumVal, statusName] of Object.entries(ENUM_TO_STATUS)) {
    const rec = await prisma.shippingStatus.findFirst({ where: { name: statusName } });
    if (!rec) throw new Error(`Status not found: ${statusName}`);
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "Order" SET "statusId" = $1 WHERE status::text = $2 AND "statusId" IS NULL`,
      rec.id, enumVal
    );
    console.log(`  ✓ ${n} orders: ${enumVal} → ${statusName}`);
  }

  // Fallback
  const fallback = await prisma.shippingStatus.findFirst({ where: { name: "جاهز للشحن" } });
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "Order" SET "statusId" = $1 WHERE "statusId" IS NULL`,
    fallback.id
  );
  if (n > 0) console.log(`  ✓ ${n} orders assigned fallback`);

  // 4. Add FK constraint
  console.log("Step 4: Add FK constraint...");
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_statusId_fkey'
      ) THEN
        ALTER TABLE "Order"
          ADD CONSTRAINT "Order_statusId_fkey"
          FOREIGN KEY ("statusId") REFERENCES "ShippingStatus"(id);
      END IF;
    END $$
  `);
  console.log("  ✓ FK added");

  // 5. Drop ShippingInfo.shippingStatusId
  console.log("Step 5: Drop ShippingInfo.shippingStatusId...");
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ShippingInfo" DROP COLUMN IF EXISTS "shippingStatusId"`
  );
  console.log("  ✓ column dropped");

  console.log("\n✅ Migration complete!");
  console.log("Next steps:");
  console.log("  npx prisma db push --accept-data-loss");
  console.log("  npx prisma generate");
}

main()
  .catch(e => { console.error("❌ Failed:", e.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
