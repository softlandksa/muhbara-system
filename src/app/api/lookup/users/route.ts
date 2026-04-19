import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role } = session.user;
  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const roles  = searchParams.getAll("role") as Role[];
  const teamId = searchParams.get("teamId");

  const data = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(roles.length > 0 && { role: { in: roles } }),
      ...(teamId && { teamId }),
    },
    select: { id: true, name: true, role: true, email: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=30" },
  });
}
