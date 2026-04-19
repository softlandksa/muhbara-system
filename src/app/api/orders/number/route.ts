import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/order-number";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role } = session.user;
  if (role !== "ADMIN" && role !== "SALES") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  // Preview only — not reserved; actual generation is in POST /api/orders
  const year = new Date().getFullYear();
  const count = await prisma.order.count({
    where: { orderNumber: { startsWith: `ORD-${year}-` } },
  });
  const orderNumber = `ORD-${year}-${String(count + 1).padStart(5, "0")}`;
  return NextResponse.json({ data: { orderNumber } });
}
