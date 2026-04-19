import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { role, teamId } = session.user;
  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusIds = searchParams.getAll("status");
  const countryIds = searchParams.getAll("countryId");
  const currencyId = searchParams.get("currencyId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const roleFilter: Record<string, unknown> = { deletedAt: null };
  if (role === "SALES_MANAGER" && teamId) roleFilter.teamId = teamId;

  const userFilter: Record<string, unknown> = {};
  if (statusIds.length > 0) userFilter.statusId = { in: statusIds };
  if (countryIds.length > 0) userFilter.countryId = { in: countryIds };
  if (currencyId) userFilter.currencyId = currencyId;
  if (dateFrom) userFilter.orderDate = { gte: new Date(dateFrom) };
  if (dateTo) userFilter.orderDate = { ...(userFilter.orderDate as object ?? {}), lte: new Date(dateTo + "T23:59:59") };

  const ids = searchParams.getAll("ids");
  if (ids.length > 0) userFilter.id = { in: ids };

  const orders = await prisma.order.findMany({
    where: { AND: [roleFilter, userFilter] },
    include: {
      status: { select: { name: true } },
      country: true,
      currency: true,
      paymentMethod: true,
      createdBy: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = orders.map((o) => ({
    "رقم الطلب": o.orderNumber,
    "التاريخ": format(new Date(o.orderDate), "dd/MM/yyyy"),
    "اسم العميل": o.customerName,
    "الجوال": o.phone,
    "العنوان": o.address,
    "الدولة": o.country.name,
    "المنتجات": o.items.map((i) => `${i.product.name} (${i.quantity})`).join(" - "),
    "المبلغ الإجمالي": o.totalAmount,
    "العملة": o.currency.code,
    "طريقة الدفع": o.paymentMethod.name,
    "الحالة": o.status.name,
    "المنشئ": o.createdBy.name,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `طلبات_${format(new Date(), "yyyy-MM-dd")}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
