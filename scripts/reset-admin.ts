import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL or DIRECT_URL must be set");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "kamel@prameg.net";
  const password = "123456";

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
