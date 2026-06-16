import type { Prisma } from "@prisma/client";

const ORDER_NUMBER_LOCK_ID = BigInt(20240001);

export async function generateOrderNumber(
  tx: Prisma.TransactionClient
): Promise<string> {
  const year = new Date().getFullYear();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_ID})`;
  // Use MAX(last sequence) not COUNT — COUNT breaks when rows are hard-deleted (gaps in sequence).
  const last = await tx.order.findFirst({
    where: { orderNumber: { startsWith: `ORD-${year}-` } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  const lastSeq = last ? parseInt(last.orderNumber.slice(-5), 10) : 0;
  const seq = String(lastSeq + 1).padStart(5, "0");
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
  // Use MAX(last sequence) not COUNT — same gap-safety fix as generateOrderNumber.
  const last = await tx.order.findFirst({
    where: { orderNumber: { startsWith: `ORD-${year}-` } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  const base = last ? parseInt(last.orderNumber.slice(-5), 10) : 0;
  return Array.from({ length: count }, (_, i) =>
    `ORD-${year}-${String(base + i + 1).padStart(5, "0")}`,
  );
}
