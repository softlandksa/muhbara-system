import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const companies = await prisma.shippingCompany.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: companies }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const body = await request.json();
  const { name, trackingUrl } = body;

  if (!name) {
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
  }

  const existing = await prisma.shippingCompany.findFirst({
    where: { name, deletedAt: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: "شركة الشحن موجودة بالفعل" },
      { status: 409 }
    );
  }

  const company = await prisma.shippingCompany.create({
    data: { name, trackingUrl },
  });

  return NextResponse.json({ data: company }, { status: 201 });
}
