import type { Prisma } from "@prisma/client";

const ORDER_NUMBER_LOCK_ID = BigInt(20240001);

export async function generateOrderNumber(
  tx: Prisma.TransactionClient
): Promise<string> {
  const year = new Date().getFullYear();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_ID})`;
  const count = await tx.order.count({
    where: { orderNumber: { startsWith: `ORD-${year}-` } },
  });
  const seq = String(count + 1).padStart(5, "0");
  return `ORD-${year}-${seq}`;
}
