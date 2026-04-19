/**
 * Migration: Populate ShippingStatusSub from existing ShippingStatusPrimary rows.
 * Run once after `prisma db push`:
 *   node prisma/migrate-to-two-tier-status.mjs
 *
 * Strategy: For every ShippingStatusPrimary, create one default sub with the
 * same name. The sub marked marksOrderDelivered=true if the primary name
 * contains "توصيل" (delivery). Skips subs that already exist (idempotent).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const primaries = await prisma.shippingStatusPrimary.findMany({
    orderBy: { sortOrder: "asc" },
  });

  console.log(`Found ${primaries.length} primary statuses. Creating default subs...`);

  let created = 0;
  let skipped = 0;

  for (const primary of primaries) {
    const marksDelivered =
      primary.name.includes("توصيل") || primary.name.toLowerCase().includes("deliver");

    const existing = await prisma.shippingStatusSub.findFirst({
      where: { primaryId: primary.id, deletedAt: null },
    });

    if (existing) {
      console.log(`  ↷ Skip (already has subs): ${primary.name}`);
      skipped++;
      continue;
    }

    await prisma.shippingStatusSub.create({
      data: {
        primaryId:          primary.id,
        name:               primary.name,
        sortOrder:          1,
        isActive:           primary.isActive,
        marksOrderDelivered: marksDelivered,
      },
    });

    console.log(
      `  ✓ ${primary.name}${marksDelivered ? " [marksOrderDelivered]" : ""}`
    );
    created++;
  }

  console.log(`\n✅ Done — ${created} subs created, ${skipped} primaries skipped.`);
}

main()
  .catch((e) => { console.error("❌ Failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
