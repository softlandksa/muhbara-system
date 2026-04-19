import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Hard cap: prevents unbounded queries on the follow-up list.
// The page has no pagination UI, so this acts as a safety ceiling.
const FOLLOW_UP_LIMIT = 200;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, teamId } = session.user;
  if (role !== "ADMIN" && role !== "FOLLOWUP" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusIds = searchParams.getAll("status");
  const countryIds = searchParams.getAll("countryId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const search = searchParams.get("search")?.trim();

  // Role-based base filter
  const baseFilter: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) baseFilter.teamId = teamId;
  if (statusIds.length > 0) baseFilter.statusId = { in: statusIds };

  const userFilter: Record<string, unknown> = {};
  if (countryIds.length > 0) userFilter.countryId = { in: countryIds };
  if (dateFrom) userFilter.orderDate = { gte: new Date(dateFrom) };
  if (dateTo)
    userFilter.orderDate = {
      ...(userFilter.orderDate as object ?? {}),
      lte: new Date(dateTo + "T23:59:59"),
    };
  if (search) {
    userFilter.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }

  const orders = await prisma.order.findMany({
    where: { AND: [baseFilter, userFilter] },
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      customerName: true,
      phone: true,
      address: true,
      totalAmount: true,
      status: { select: { id: true, name: true, color: true } },
      country: { select: { id: true, name: true } },
      currency: { select: { id: true, code: true, symbol: true } },
      createdBy: { select: { id: true, name: true } },
      // Limit items per order — cell is truncated to max-w-[150px] anyway.
      items: {
        take: 5,
        include: { product: { select: { id: true, name: true } } },
      },
      shippingInfo: {
        select: {
          id: true,
          trackingNumber: true,
          shippedAt: true,
          shippingCompany: { select: { id: true, name: true, trackingUrl: true } },
        },
      },
      // Limit follow-up notes per order for list view; dialog shows them all.
      followUpNotes: {
        orderBy: { createdAt: "asc" },
        take: 50,
        include: { createdBy: { select: { id: true, name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: FOLLOW_UP_LIMIT,
  });

  return NextResponse.json({ data: orders });
}
