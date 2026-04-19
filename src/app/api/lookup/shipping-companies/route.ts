import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role } = session.user;
  if (role !== "ADMIN" && role !== "SHIPPING") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const data = await prisma.shippingCompany.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data }, {
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=60" },
  });
}
