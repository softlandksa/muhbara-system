"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  ShoppingCart, CalendarDays, Package, Truck, CheckCircle,
  RotateCcw, TrendingUp, TrendingDown, CalendarIcon, Tag,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type PrimaryStatItem = {
  id: string; name: string; color: string; count: number; isDeliveredBucket: boolean;
};
type Stats = {
  total: number; todayOrders: number; delivered: number;
  // §12.1: dynamic array — one entry per active ShippingStatusPrimary
  statuses: PrimaryStatItem[];
};
type DashboardData = {
  stats: Stats;
  dailyChart: { date: string; count: number; revenue: number }[];
  statusChart: { name: string; value: number; color: string }[];
  countryChart: { name: string; count: number; revenue: number }[];
  paymentChart: { name: string; value: number }[];
  recentOrders: {
    id: string; orderNumber: string; customerName: string;
    status: { id: string; name: string; color: string }; totalAmount: number; orderDate: string;
    country: { name: string }; currency: { code: string };
  }[];
};

const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#14b8a6",
];

// ─── Custom X-axis tick — wraps long Arabic country names into ≤2 lines ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomXAxisTick({ x, y, payload }: any) {
  const name: string = payload?.value ?? "";
  const words = name.trim().split(/\s+/);
  // Split into at most 2 lines at the midpoint
  let lines: string[];
  if (words.length <= 2) {
    lines = [name];
  } else {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill="#374151"
        fontFamily="IBM Plex Sans Arabic"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? "0.9em" : "1.3em"}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieTooltipContent({ active, payload, total }: {
  active?: boolean;
  payload?: readonly Record<string, any>[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const numVal = typeof item.value === "number" ? item.value : 0;
  const pct = total > 0 ? Math.round((numVal / total) * 100) : 0;
  return (
    <div className="chart-tooltip">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.fill }} />
        <span className="font-semibold text-foreground">{item.name}</span>
      </div>
      <div className="flex justify-between text-xs gap-4">
        <span className="text-muted-foreground">العدد</span>
        <span className="font-bold text-foreground">{numVal.toLocaleString()}</span>
      </div>
      <div className="flex justify-between text-xs gap-4 mt-0.5">
        <span className="text-muted-foreground">النسبة</span>
        <span className="font-bold text-primary">{pct}%</span>
      </div>
    </div>
  );
}

// ─── Pie Legend ───────────────────────────────────────────────────────────────

function PieLegend({ items }: {
  items: { name: string; value: number; color: string }[];
}) {
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

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  title, value, icon, bgColor, iconColor, change, colorHex,
}: {
  title: string; value: number | string;
  icon: React.ReactNode;
  bgColor?: string; iconColor?: string;
  colorHex?: string;
  change?: number;
}) {
  const iconBgStyle = colorHex ? { backgroundColor: colorHex + "22" } : undefined;
  const iconFgStyle = colorHex ? { color: colorHex } : undefined;
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className="text-3xl font-bold mt-1 tracking-tight">{value}</p>
            {change !== undefined && (
              <div className={cn("flex items-center gap-1 text-xs mt-1.5 font-medium", change >= 0 ? "text-green-600" : "text-red-500")}>
                {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(change)}% عن السابق
              </div>
            )}
          </div>
          <div className={cn("p-3 rounded-2xl", bgColor)} style={iconBgStyle}>
            <span className={iconColor} style={iconFgStyle}>{icon}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function primaryIcon(name: string, isDeliveredBucket: boolean) {
  if (isDeliveredBucket) return <CheckCircle className="h-5 w-5" />;
  if (name.includes("مرتجع") || name.includes("إرجاع")) return <RotateCcw className="h-5 w-5" />;
  if (name.includes("جاهز") || name.includes("انتظار")) return <Package className="h-5 w-5" />;
  if (name.includes("طريق") || name.includes("توصيل") || name.includes("شحن") || name.includes("استلام")) {
    return <Truck className="h-5 w-5" />;
  }
  return <Tag className="h-5 w-5" />;
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function DashboardInner() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: DashboardData }>({
    queryKey: ["dashboard", qs],
    queryFn: () => fetch(`/api/reports/dashboard?${qs}`).then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const d = data?.data;
  const stats = d?.stats;

  const isAdmin = role === "ADMIN";
  const isGeneralManager = role === "GENERAL_MANAGER";
  const isManager = role === "SALES_MANAGER";
  const isSales = role === "SALES";
  const isShipping = role === "SHIPPING";
  const isFollowup = role === "FOLLOWUP";
  const showCharts = isAdmin || isGeneralManager || isManager || isSales;

  // Top 8 countries for bar chart
  const countryData = (() => {
    if (!d?.countryChart) return [];
    return [...d.countryChart]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  })();

  // Totals for pie tooltips
  const statusTotal = d?.statusChart.reduce((s, c) => s + c.value, 0) ?? 0;
  const paymentTotal = d?.paymentChart.reduce((s, c) => s + c.value, 0) ?? 0;

  // Payment items with colors for legend
  const paymentItems = (d?.paymentChart ?? []).map((item, i) => ({
    ...item,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">لوحة التحكم</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {role ? ROLE_LABELS[role] : ""} ·{" "}
            {format(new Date(), "EEEE، dd MMMM yyyy", { locale: arSA })}
          </p>
        </div>
        {(isAdmin || isGeneralManager || isManager) && (
          <div className="flex items-center gap-2">
            <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
              <PopoverTrigger className="flex h-9 items-center gap-1.5 rounded-xl border border-input bg-background px-3 text-sm font-medium hover:bg-accent transition-colors">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className={dateFrom ? "text-foreground" : "text-muted-foreground"}>{dateFrom || "من تاريخ"}</span>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={dateFrom ? new Date(dateFrom) : undefined}
                  onDayClick={(d) => { updateParam("dateFrom", format(d, "yyyy-MM-dd")); setDateFromOpen(false); }} />
              </PopoverContent>
            </Popover>
            <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
              <PopoverTrigger className="flex h-9 items-center gap-1.5 rounded-xl border border-input bg-background px-3 text-sm font-medium hover:bg-accent transition-colors">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className={dateTo ? "text-foreground" : "text-muted-foreground"}>{dateTo || "إلى تاريخ"}</span>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={dateTo ? new Date(dateTo) : undefined}
                  onDayClick={(d) => { updateParam("dateTo", format(d, "yyyy-MM-dd")); setDateToOpen(false); }} />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {/* Stats cards — §12.1: fixed header cards + dynamic primary cards from API */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {(isAdmin || isGeneralManager || isManager || isSales) && (
            <StatCard title="إجمالي الطلبات" value={stats?.total ?? 0}
              icon={<ShoppingCart className="h-5 w-5" />} bgColor="bg-indigo-100" iconColor="text-indigo-600" />
          )}
          {(isAdmin || isManager || isSales) && (
            <StatCard title="طلبات اليوم" value={stats?.todayOrders ?? 0}
              icon={<CalendarDays className="h-5 w-5" />} bgColor="bg-violet-100" iconColor="text-violet-600" />
          )}
          {/* Dynamic primary cards — one per active ShippingStatusPrimary from DB */}
          {(stats?.statuses ?? []).map((s) => (
            <StatCard
              key={s.id}
              title={s.name}
              value={s.count}
              icon={primaryIcon(s.name, s.isDeliveredBucket)}
              colorHex={s.color}
            />
          ))}
        </div>
      )}

      {/* Charts */}
      {showCharts && !isLoading && d && (
        <>
          {/* Row 1: Area chart + Status donut */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Area chart — 3/5 */}
            <Card className="lg:col-span-3 border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">الطلبات اليومية</CardTitle>
                <CardDescription className="text-xs">عدد الطلبات آخر 30 يوم</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={d.dailyChart} margin={{ top: 10, right: 8, left: -20, bottom: 40 }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.15} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => v.slice(5)}
                      angle={-45}
                      textAnchor="end"
                      height={55}
                      tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<BarTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#areaGrad)"
                      name="طلبات"
                      dot={{ r: 3, fill: "#6366f1", strokeWidth: 2, stroke: "#fff" }}
                      activeDot={{ r: 5, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }}
                      isAnimationActive={true}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Status donut — 2/5 */}
            <Card className="lg:col-span-2 border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">توزيع الحالات</CardTitle>
                <CardDescription className="text-xs">نسبة كل حالة من الطلبات</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={d.statusChart}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={3}
                      isAnimationActive={true}
                    >
                      {d.statusChart.map((entry, i) => (
                        <Cell key={i} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={(props) => <PieTooltipContent {...props} total={statusTotal} />} />
                  </PieChart>
                </ResponsiveContainer>
                <PieLegend items={d.statusChart} />
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Country bar chart + Payment donut */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Country vertical bar chart — 3/5 */}
            <Card className="lg:col-span-3 border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">الطلبات حسب الدولة</CardTitle>
                <CardDescription className="text-xs">أعلى {countryData.length} دول</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart
                    data={countryData}
                    margin={{ top: 24, right: 16, bottom: 110, left: 56 }}
                    barCategoryGap="20%"
                  >
                    <defs>
                      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.8} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.15} />
                    <XAxis
                      dataKey="name"
                      tick={<CustomXAxisTick />}
                      height={90}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      allowDecimals={false}
                      width={48}
                      tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8", fontWeight: 700 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<BarTooltip />} />
                    <Bar dataKey="count" fill="url(#barGrad)" radius={[6, 6, 0, 0]} name="طلبات" barSize={50} isAnimationActive={true}>
                      <LabelList
                        dataKey="count"
                        position="top"
                        offset={12}
                        style={{ fontSize: 13, fontFamily: "IBM Plex Sans Arabic", fill: "#6366f1", fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Payment donut — 2/5 */}
            <Card className="lg:col-span-2 border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">طرق الدفع</CardTitle>
                <CardDescription className="text-xs">توزيع الطلبات حسب طريقة الدفع</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={d.paymentChart}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={3}
                      isAnimationActive={true}
                    >
                      {d.paymentChart.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={(props) => <PieTooltipContent {...props} total={paymentTotal} />} />
                  </PieChart>
                </ResponsiveContainer>
                <PieLegend items={paymentItems} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Recent orders */}
      {d?.recentOrders && d.recentOrders.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-6 pt-6">
            <div>
              <CardTitle className="text-base font-semibold">آخر الطلبات</CardTitle>
              <CardDescription className="text-xs">أحدث {d.recentOrders.length} طلب</CardDescription>
            </div>
            <button
              className="text-sm text-primary hover:underline font-medium"
              onClick={() => router.push("/orders")}
            >
              عرض الكل
            </button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الدولة</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.recentOrders.map((order) => (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/orders/${order.id}`)}
                  >
                    <TableCell className="font-mono text-sm font-medium">{order.orderNumber}</TableCell>
                    <TableCell>{order.customerName}</TableCell>
                    <TableCell>{order.country.name}</TableCell>
                    <TableCell className="font-medium">
                      {order.totalAmount.toFixed(2)} {order.currency.code}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
                        {order.status.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(order.orderDate), "dd/MM/yyyy", { locale: arSA })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-5 gap-6">
          <Skeleton className="col-span-3 h-80" />
          <Skeleton className="col-span-2 h-80" />
        </div>
        <div className="grid grid-cols-5 gap-6">
          <Skeleton className="col-span-3 h-80" />
          <Skeleton className="col-span-2 h-80" />
        </div>
      </div>
    }>
      <DashboardInner />
    </Suspense>
  );
}
