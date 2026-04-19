import type { Prisma, Role, NotificationType } from "@prisma/client";

export async function createNotificationsForRole(
  tx: Prisma.TransactionClient,
  params: {
    role: Role;
    title: string;
    message: string;
    type: NotificationType;
    relatedOrderId?: string;
  }
): Promise<void> {
  const users = await tx.user.findMany({
    where: { role: params.role, isActive: true },
    select: { id: true },
  });
  if (users.length === 0) return;
  await tx.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      title: params.title,
      message: params.message,
      type: params.type,
      relatedOrderId: params.relatedOrderId ?? null,
      isRead: false,
    })),
  });
}
