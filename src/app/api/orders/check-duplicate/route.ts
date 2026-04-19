import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const orderPreviewInclude = {
  status: { select: { id: true, name: true, color: true } },
  country: { select: { name: true } },
  currency: { select: { code: true } },
  items: {
    include: { product: { select: { name: true } } },
    take: 2,
  },
};

// GET /api/orders/check-duplicate?phone=xxx&customerName=yyy
// Single-order check used by the creation form in real-time
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone")?.trim() ?? "";
  const customerName = searchParams.get("customerName")?.trim() ?? "";

  if (!phone && !customerName) {
    return NextResponse.json({ isDuplicate: false, existingOrders: [], nameMatches: [] });
  }

  // Phone match (primary — exact phone contains the input)
  let existingOrders: unknown[] = [];
  if (phone.length >= 6) {
    existingOrders = await prisma.order.findMany({
      where: { phone: { contains: phone }, deletedAt: null },
      include: orderPreviewInclude,
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }

  // Name match with different phone (secondary)
  let nameMatches: unknown[] = [];
  if (customerName.length >= 2) {
    nameMatches = await prisma.order.findMany({
      where: {
        customerName: { contains: customerName, mode: "insensitive" },
        deletedAt: null,
        ...(phone.length >= 6 ? { NOT: { phone: { contains: phone } } } : {}),
      },
      include: orderPreviewInclude,
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  }

  return NextResponse.json({
    isDuplicate: existingOrders.length > 0,
    existingOrders,
    nameMatches,
  });
}

// POST /api/orders/check-duplicate
// Batch check for the import preview — body: { phones: string[] }
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const body = await request.json() as { phones?: string[] };
  const phones = body.phones;
  if (!Array.isArray(phones) || phones.length === 0) {
    return NextResponse.json({ data: {} });
  }

  // Find all existing orders whose phone is in the list
  const existing = await prisma.order.findMany({
    where: { phone: { in: phones }, deletedAt: null },
    select: { phone: true, orderNumber: true, id: true, customerName: true },
  });

  // Group by phone
  const duplicates: Record<string, { count: number; orderNumbers: string[] }> = {};
  for (const order of existing) {
    if (!duplicates[order.phone]) {
      duplicates[order.phone] = { count: 0, orderNumbers: [] };
    }
    duplicates[order.phone].count++;
    duplicates[order.phone].orderNumbers.push(order.orderNumber);
  }

  return NextResponse.json({ data: duplicates });
}
