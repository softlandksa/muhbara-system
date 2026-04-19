import type { Prisma } from "@prisma/client";

export async function logActivity(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }
): Promise<void> {
  await tx.activityLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      details: params.details ? (params.details as Prisma.InputJsonValue) : undefined,
      ipAddress: params.ipAddress ?? null,
    },
  });
}
