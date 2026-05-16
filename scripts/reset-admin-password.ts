import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL must be set in .env");
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "kamel@prameg.net";
  const password = "Admin@123456";

  console.log(`Resetting password for: ${email}`);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Error: no user found with email "${email}"`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  console.log(`✔ Password reset successful for ${email}`);
}

main()
  .catch((e) => {
    console.error("reset-admin-password failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
