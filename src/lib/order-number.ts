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

// Acquires the advisory lock ONCE and returns `count` consecutive order numbers.
// Always call this inside the same transaction that performs the inserts so the
// lock is held until the data is committed, preventing number gaps or duplicates.
export async function generateOrderNumbers(
  tx: Prisma.TransactionClient,
  count: number,
): Promise<string[]> {
  if (count === 0) return [];
  const year = new Date().getFullYear();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_ID})`;
  const base = await tx.order.count({
    where: { orderNumber: { startsWith: `ORD-${year}-` } },
  });
  return Array.from({ length: count }, (_, i) =>
    `ORD-${year}-${String(base + i + 1).padStart(5, "0")}`,
  );
}
