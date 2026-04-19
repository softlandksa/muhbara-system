import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ orders: [], users: [], products: [] });

  const { id: userId, role, teamId } = session.user as {
    id: string; role: string; teamId: string | null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderWhere: any = {
    deletedAt: null,
    OR: [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ],
  };
  if (role === "SALES") orderWhere.createdById = userId;
  else if (role === "SALES_MANAGER" && teamId) orderWhere.teamId = teamId;
  // ADMIN, GENERAL_MANAGER, SHIPPING, FOLLOWUP see all orders — no restriction

  const productWhere = {
    isActive: true,
    deletedAt: null,
    OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      { sku: { contains: q, mode: "insensitive" as const } },
    ],
  };

  const [orders, products] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        phone: true,
        statusId: true,
        status: { select: { name: true, color: true } },
      },
      take: 5,
    }),
    prisma.product.findMany({ where: productWhere, select: { id: true, name: true, sku: true }, take: 5 }),
  ]);

  let users: { id: string; name: string; email: string; role: string }[] = [];
  if (role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userWhere: any = {
      isActive: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    };
    if (role === "SALES_MANAGER" && teamId) userWhere.teamId = teamId;
    users = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, email: true, role: true },
      take: 5,
    });
  }

  return NextResponse.json({ orders, users, products });
}
