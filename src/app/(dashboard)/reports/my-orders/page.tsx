"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Filter, X, CalendarIcon, ShoppingCart, DollarSign, Truck } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const FALLBACK_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#14b8a6",
];

type StatusChartItem  = { name: string; color: string; count: number };
type PrimaryItem      = { name: string; color: string; count: number };
type OrderRow = {
  id: string; orderNumber: string; orderDate: string;
  customerName: string; totalAmount: number;
  status: { id: string; name: string; color: string };
  currency: { code: string };
  shippingInfo: { id: string; shippingSubStatus: { primaryId: string; primary: { id: string; name: string; color: string } } | null } | null;
};

type MyOrdersData = {
  summary: { total: number; totalRevenue: number; shipped: number };
  statusChart: StatusChartItem[];
  shippingPrimaryChart: PrimaryItem[];
  orders: OrderRow[];
};

function SummaryCard({ title, value, icon, color }: {
  title: string; value: string | number; icon: React.ReactNode; color: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-1">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          </div>
          <div className={cn("p-3 rounded-2xl", color)}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function BarTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg p-3 text-sm min-w-[120px]">
      {label && <p className="font-semibold text-gray-700 mb-1.5 text-xs border-b pb-1">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-gray-500 text-xs">{p.name}</span>
          </div>
          <span className="font-bold text-gray-800">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function PieLegend({ items }: { items: { name: string; value: number; color: string }[] }) {
  const total = items.reduce((s, c) => s + c.value, 0);
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-3 px-2">
      {items.map((entry, i) => {
        const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
        return (
          <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: entry.color }} />
            <span>{entry.name}</span>
            <span className="font-semibold text-gray-800">({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

function MyOrdersInner() {
  const router   = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo   = searchParams.get("dateTo")   ?? "";
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen,   setDateToOpen]   = useState(false);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: MyOrdersData }>({
    queryKey: ["reports-my-orders", qs],
    queryFn: async () => {
      const res = await fetch(`/api/reports/my-orders?${qs}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "فشل تحميل التقرير");
        throw new Error(json.error ?? "fetch error");
      }
      return res.json();
    },
    staleTime: 60_000,
    placeholderData: prev => prev,
  });

  const hasFilters = !!(dateFrom || dateTo);
  const d = data?.data;

  const pageTitle = role === "FOLLOWUP" ? "طلباتي (متابعة)" : "طلباتي";

  const statusPieItems = (d?.statusChart ?? []).map((s, i) => ({
    name: s.name,
    value: s.count,
    color: s.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));
  const statusPieTotal = statusPieItems.reduce((s, c) => s + c.value, 0);

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : "جميع الفترات"}
          </p>
        </div>
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:bg-muted transition-colors",
            hasFilters && "border-primary text-primary bg-primary/5"
          )}>
            <Filter className="h-3.5 w-3.5" />
            {hasFilters ? "فلتر نشط" : "فلاتر"}
          </PopoverTrigger>
          <PopoverContent className="w-72 p-4 space-y-4" align="end" dir="rtl">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">من تاريخ</Label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm hover:bg-accent">
                  <span className={dateFrom ? "text-foreground" : "text-muted-foreground"}>{dateFrom || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateFrom ? new Date(dateFrom) : undefined}
                    onDayClick={(d) => { updateParam("dateFrom", format(d, "yyyy-MM-dd")); setDateFromOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground">إلى تاريخ</Label>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm hover:bg-accent">
                  <span className={dateTo ? "text-foreground" : "text-muted-foreground"}>{dateTo || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateTo ? new Date(dateTo) : undefined}
                    onDayClick={(d) => { updateParam("dateTo", format(d, "yyyy-MM-dd")); setDateToOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => router.replace(pathname)}>
                <X className="h-3 w-3 ml-1" />مسح الفلاتر
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : d && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <SummaryCard
            title="إجمالي الطلبات"
            value={d.summary.total.toLocaleString()}
            icon={<ShoppingCart className="h-5 w-5 text-indigo-600" />}
            color="bg-indigo-100"
          />
          <SummaryCard
            title="إجمالي الإيرادات"
            value={d.summary.totalRevenue.toLocaleString()}
            icon={<DollarSign className="h-5 w-5 text-emerald-600" />}
            color="bg-emerald-100"
          />
          <SummaryCard
            title="تم الشحن"
            value={d.summary.shipped.toLocaleString()}
            icon={<Truck className="h-5 w-5 text-violet-600" />}
            color="bg-violet-100"
          />
        </div>
      )}

      {/* Charts */}
      {!isLoading && d && d.summary.total > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status bar chart */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">الطلبات حسب الحالة</CardTitle>
                <CardDescription className="text-xs">توزيع طلباتك على حالات الشحن</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={d.statusChart}
                    margin={{ top: 20, right: 16, bottom: 60, left: 8 }}
                    barCategoryGap="25%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.15} />
                    <XAxis
                      dataKey="name"
                      angle={-35}
                      textAnchor="end"
                      height={70}
                      tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<BarTooltip />} />
                    <Bar dataKey="count" name="طلبات" radius={[6, 6, 0, 0]} barSize={40} isAnimationActive={true}>
                      {d.statusChart.map((entry, i) => (
                        <Cell key={i} fill={entry.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="top"
                        offset={8}
                        style={{ fontSize: 12, fontFamily: "IBM Plex Sans Arabic", fontWeight: 700, fill: "#374151" }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Status pie */}
            {statusPieItems.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-0 px-6 pt-6">
                  <CardTitle className="text-base font-semibold">توزيع الحالات</CardTitle>
                  <CardDescription className="text-xs">النسبة المئوية لكل حالة</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={statusPieItems}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        dataKey="value"
                        nameKey="name"
                        paddingAngle={3}
                        isAnimationActive={true}
                      >
                        {statusPieItems.map((entry, i) => (
                          <Cell key={i} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const item = payload[0];
                          const pct = statusPieTotal > 0 ? Math.round(((item.value as number) / statusPieTotal) * 100) : 0;
                          return (
                            <div className="bg-white border border-gray-100 rounded-lg shadow-lg p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.payload?.color }} />
                                <span className="font-semibold">{item.name}</span>
                              </div>
                              <div className="flex justify-between gap-4 text-xs">
                                <span className="text-muted-foreground">العدد</span>
                                <span className="font-bold">{(item.value as number).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between gap-4 text-xs mt-0.5">
                                <span className="text-muted-foreground">النسبة</span>
                                <span className="font-bold text-primary">{pct}%</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <PieLegend items={statusPieItems} />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Shipping primary breakdown (shipped subset) */}
          {d.shippingPrimaryChart.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">الشحنات حسب الحالة الرئيسية</CardTitle>
                <CardDescription className="text-xs">توزيع الطلبات المشحونة على حالات الشحن الرئيسية</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={d.shippingPrimaryChart}
                      margin={{ top: 20, right: 8, bottom: 60, left: 8 }}
                      barCategoryGap="25%"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.15} />
                      <XAxis
                        dataKey="name"
                        angle={-35}
                        textAnchor="end"
                        height={70}
                        tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<BarTooltip />} />
                      <Bar dataKey="count" name="شحنات" radius={[6, 6, 0, 0]} barSize={40}>
                        {d.shippingPrimaryChart.map((entry, i) => (
                          <Cell key={i} fill={entry.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                        ))}
                        <LabelList
                          dataKey="count"
                          position="top"
                          offset={8}
                          style={{ fontSize: 12, fontFamily: "IBM Plex Sans Arabic", fontWeight: 700, fill: "#374151" }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 self-center">
                    {d.shippingPrimaryChart.map((entry, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: entry.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
                          <span className="text-muted-foreground">{entry.name}</span>
                        </div>
                        <span className="font-semibold">{entry.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Orders table */}
          {d.orders.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-6 pt-6">
                <CardTitle className="text-base font-semibold">قائمة الطلبات</CardTitle>
                <CardDescription className="text-xs">{d.orders.length} طلب — أول 100 نتيجة</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم الطلب</TableHead>
                        <TableHead>العميل</TableHead>
                        <TableHead>المبلغ</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>حالة الشحن</TableHead>
                        <TableHead>التاريخ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.orders.map(o => (
                        <TableRow
                          key={o.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => router.push(`/orders/${o.id}`)}
                        >
                          <TableCell className="font-mono text-sm font-medium">{o.orderNumber}</TableCell>
                          <TableCell>{o.customerName}</TableCell>
                          <TableCell className="font-medium">{o.totalAmount.toFixed(2)} {o.currency.code}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs border" style={{
                              backgroundColor: o.status.color + "22",
                              color: o.status.color,
                              borderColor: o.status.color + "55",
                            }}>
                              {o.status.name}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {o.shippingInfo?.shippingSubStatus?.primary ? (
                              <Badge variant="outline" className="text-xs border" style={{
                                backgroundColor: o.shippingInfo.shippingSubStatus.primary.color + "22",
                                color: o.shippingInfo.shippingSubStatus.primary.color,
                                borderColor: o.shippingInfo.shippingSubStatus.primary.color + "55",
                              }}>
                                {o.shippingInfo.shippingSubStatus.primary.name}
                              </Badge>
                            ) : o.shippingInfo ? (
                              <span className="text-xs text-muted-foreground">مشحون</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(o.orderDate), "dd/MM/yyyy", { locale: arSA })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!isLoading && d && d.summary.total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ShoppingCart className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">لا توجد طلبات للفترة المحددة</p>
        </div>
      )}
    </div>
  );
}

export default function MyOrdersReportPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-72" /><Skeleton className="h-72" />
        </div>
        <Skeleton className="h-64" />
      </div>
    }>
      <MyOrdersInner />
    </Suspense>
  );
}
