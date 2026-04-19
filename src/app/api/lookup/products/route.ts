import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const data = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true, sku: true, defaultPrice: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data }, {
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=60" },
  });
}
