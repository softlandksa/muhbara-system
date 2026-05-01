import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL must be set in .env");
  process.exit(1);
}

// Supabase pooler requires SSL; local scripts must enable it explicitly.
const adapter = new PrismaPg({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "kamel@prameg.net";
  const password = "12345678";

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
    create: {
      name: "كامل",
      email,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log("Admin user ready:", admin.email, "| role:", admin.role);
}

main()
  .catch((e) => {
    console.error("reset-admin failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
