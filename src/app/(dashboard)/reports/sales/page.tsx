"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Download, Filter, CalendarIcon, X, TrendingUp, ShoppingCart, CheckCircle, Percent } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type StatusItem = { id: string; name: string; color: string };

const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#14b8a6",
];

type SalesData = {
  orders: {
    id: string; orderNumber: string; orderDate: string; customerName: string;
    status: StatusItem; totalAmount: number;
    country: { name: string }; currency: { code: string };
    paymentMethod: { name: string }; createdBy: { name: string };
  }[];
  summary: { total: number; totalRevenue: number };
  dailyChart: { date: string; count: number; revenue: number }[];
  countryChart: { name: string; count: number; revenue: number }[];
  currencyChart: { name: string; value: number; revenue: number }[];
  paymentChart: { name: string; value: number }[];
  statusChart: { name: string; count: number; revenue: number }[];
};

// ─── Custom X-axis tick — wraps long Arabic country names into ≤2 lines ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomXAxisTick({ x, y, payload }: any) {
  const name: string = payload?.value ?? "";
  const words = name.trim().split(/\s+/);
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

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ title, value, icon, color }: {
  title: string; value: string | number;
  icon: React.ReactNode; color: string;
}) {
  return (
    <Card className="border-0 shadow-sm h-full">
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

// ─── Revenue Summary Card (enlarged, per-currency breakdown) ──────────────────

function RevenueSummaryCard({
  currencies,
  totalOrders,
}: {
  currencies: { code: string; revenue: number }[];
  totalOrders: number;
}) {
  const nonEmpty = currencies
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  return (
    <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-green-50/40 h-full">
      <CardContent className="p-5 flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">إجمالي الإيرادات</p>
            {totalOrders > 0 && (
              <p className="text-[11px] text-emerald-600/60 mt-0.5">
                {totalOrders.toLocaleString()} طلب
              </p>
            )}
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-100 shrink-0">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </div>
        </div>

        {nonEmpty.length === 0 ? (
          <p className="text-3xl font-bold text-muted-foreground">—</p>
        ) : (
          <div className="space-y-1.5">
            {nonEmpty.map((c, i) => (
              <div
                key={c.code}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5",
                  i === 0 ? "bg-emerald-100/70" : "bg-emerald-50/50"
                )}
              >
                <span className="text-xs font-bold font-mono text-emerald-700 tabular-nums">
                  {c.code}
                </span>
                <span
                  className={cn(
                    "font-bold tabular-nums text-emerald-900 tracking-tight",
                    i === 0 ? "text-2xl" : "text-base"
                  )}
                >
                  {c.revenue.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function SalesReportsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const statusParams = searchParams.getAll("status");
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const allStatuses = statusesData?.data ?? [];

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };
  const toggleStatus = (s: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const curr = params.getAll("status");
    if (curr.includes(s)) {
      params.delete("status");
      curr.filter(x => x !== s).forEach(x => params.append("status", x));
    } else params.append("status", s);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: SalesData }>({
    queryKey: ["reports-sales", qs],
    queryFn: () => fetch(`/api/reports/sales?${qs}`).then(r => r.json()),
    staleTime: 60_000,
    placeholderData: prev => prev,
  });

  const hasFilters = dateFrom || dateTo || statusParams.length > 0;
  const d = data?.data;

  // Top 8 countries for bar chart
  const countryData = (() => {
    if (!d?.countryChart) return [];
    return [...d.countryChart].sort((a, b) => b.count - a.count).slice(0, 8);
  })();

  // Items with colors for pie legends
  const currencyItems = (d?.currencyChart ?? []).map((item, i) => ({
    name: item.name,
    value: item.value,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));
  const paymentItems = (d?.paymentChart ?? []).map((item, i) => ({
    ...item,
    color: ["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#ec4899"][i % 6],
  }));

  const currencyTotal = d?.currencyChart.reduce((s, c) => s + c.value, 0) ?? 0;
  const paymentTotal = d?.paymentChart.reduce((s, c) => s + c.value, 0) ?? 0;

  const deliveredCount = d?.statusChart.find(s => s.name === "تم التوصيل")?.count ?? 0;
  const deliveryRate = d && d.summary.total > 0
    ? Math.round((deliveredCount / d.summary.total) * 100) : 0;

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const params = new URLSearchParams(searchParams.toString());
      const res = await fetch(`/api/orders/export?${params}`);
      if (!res.ok) { toast.error("فشل التصدير"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `تقرير_المبيعات_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExportLoading(false); }
  };

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">تقارير المبيعات</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : "جميع الفترات"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER") && (
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exportLoading}>
              <Download className="h-4 w-4 ml-1" />تصدير
            </Button>
          )}
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
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">الحالة</Label>
                <div className="space-y-1.5">
                  {allStatuses.map(s => (
                    <div key={s.id} className="flex items-center gap-2">
                      <Checkbox id={`s-${s.id}`} checked={statusParams.includes(s.id)} onCheckedChange={() => toggleStatus(s.id)} />
                      <label htmlFor={`s-${s.id}`} className="text-xs cursor-pointer">{s.name}</label>
                    </div>
                  ))}
                </div>
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
      </div>

      {/* Summary cards — revenue first (rightmost in RTL), enlarged with per-currency breakdown */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="col-span-2 lg:col-span-2"><Skeleton className="h-32" /></div>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : d && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 items-start">
          {/* Revenue card — first in DOM = rightmost in RTL; spans 2 cols at all sizes */}
          <div className="col-span-2 lg:col-span-2">
            <RevenueSummaryCard
              currencies={d.currencyChart.map((c) => ({ code: c.name, revenue: c.revenue }))}
              totalOrders={d.summary.total}
            />
          </div>
          {/* Compact KPI cards */}
          <SummaryCard
            title="إجمالي الطلبات"
            value={d.summary.total.toLocaleString()}
            icon={<ShoppingCart className="h-5 w-5 text-indigo-600" />}
            color="bg-indigo-100"
          />
          <SummaryCard
            title="تم التوصيل"
            value={deliveredCount.toLocaleString()}
            icon={<CheckCircle className="h-5 w-5 text-green-600" />}
            color="bg-green-100"
          />
          <SummaryCard
            title="معدل التوصيل"
            value={`${deliveryRate}%`}
            icon={<Percent className="h-5 w-5 text-violet-600" />}
            color="bg-violet-100"
          />
        </div>
      )}

      {/* Charts */}
      {!isLoading && d && (
        <>
          {/* Row 1: Daily area + Country bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">المبيعات حسب التاريخ</CardTitle>
                <CardDescription className="text-xs">عدد الطلبات لكل يوم في الفترة المحددة</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={d.dailyChart} margin={{ top: 10, right: 8, left: -20, bottom: 40 }}>
                    <defs>
                      <linearGradient id="salesAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#salesAreaGrad)"
                      name="طلبات"
                      dot={{ r: 3, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                      activeDot={{ r: 5, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }}
                      isAnimationActive={true}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">المبيعات حسب الدولة</CardTitle>
                <CardDescription className="text-xs">أعلى {countryData.length} دول من حيث عدد الطلبات</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart
                    data={countryData}
                    margin={{ top: 24, right: 16, bottom: 110, left: 56 }}
                    barCategoryGap="20%"
                  >
                    <defs>
                      <linearGradient id="salesBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.8} />
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
                    <Bar dataKey="count" fill="url(#salesBarGrad)" radius={[6, 6, 0, 0]} name="طلبات" barSize={50} isAnimationActive={true}>
                      <LabelList
                        dataKey="count"
                        position="top"
                        offset={12}
                        style={{ fontSize: 13, fontFamily: "IBM Plex Sans Arabic", fill: "#10b981", fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Currency donut + Payment donut */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">المبيعات حسب العملة</CardTitle>
                <CardDescription className="text-xs">توزيع الطلبات على العملات المختلفة</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={d.currencyChart}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={3}
                      isAnimationActive={true}
                    >
                      {d.currencyChart.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={(props) => <PieTooltipContent {...props} total={currencyTotal} />} />
                  </PieChart>
                </ResponsiveContainer>
                <PieLegend items={currencyItems} />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">المبيعات حسب طريقة الدفع</CardTitle>
                <CardDescription className="text-xs">توزيع الطلبات على طرق الدفع</CardDescription>
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
                        <Cell
                          key={i}
                          fill={["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#ec4899"][i % 6]}
                          stroke="none"
                        />
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

      {/* Detailed table */}
      {!isLoading && d && d.orders.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2 px-6 pt-6">
            <CardTitle className="text-base font-semibold">جدول تفصيلي</CardTitle>
            <CardDescription className="text-xs">{d.orders.length} طلب — أول 100 نتيجة</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>الدولة</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>طريقة الدفع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المنشئ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.orders.slice(0, 100).map(o => (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/orders/${o.id}`)}
                    >
                      <TableCell className="font-mono text-sm font-medium">{o.orderNumber}</TableCell>
                      <TableCell>{o.customerName}</TableCell>
                      <TableCell>{o.country.name}</TableCell>
                      <TableCell className="font-medium">{o.totalAmount.toFixed(2)} {o.currency.code}</TableCell>
                      <TableCell>{o.paymentMethod.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs border" style={{ backgroundColor: o.status.color + "22", color: o.status.color, borderColor: o.status.color + "55" }}>
                          {o.status.name}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(o.orderDate), "dd/MM/yyyy", { locale: arSA })}
                      </TableCell>
                      <TableCell className="text-sm">{o.createdBy.name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function SalesReportsPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="col-span-2 lg:col-span-2"><Skeleton className="h-32" /></div>
          <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-80" /><Skeleton className="h-80" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-72" /><Skeleton className="h-72" />
        </div>
      </div>
    }>
      <SalesReportsInner />
    </Suspense>
  );
}
