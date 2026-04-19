"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Filter, X, CalendarIcon, Truck, CheckCircle, Package, Download } from "lucide-react";
import {
  PieChart, Pie, Cell,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PrimaryItem = {
  id: string;
  name: string;
  color: string;
  count: number;
  delivered: number;
};

type DailyItem = { date: string; count: number };

type ShippingReportData = {
  summary: { totalOrders: number; deliveredCount: number };
  primaries: PrimaryItem[];
  totals: { orderCount: number; deliveredCount: number };
  dailyChart: DailyItem[];
};

// ─── Summary card ─────────────────────────────────────────────────────────────

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

// ─── Tooltips ─────────────────────────────────────────────────────────────────

function BarTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg p-3 text-sm min-w-[130px]">
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

// ─── Pie legend ───────────────────────────────────────────────────────────────

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

// ─── CSS bar chart row — name | bar | count ──────────────────────────────────
// Rendered as plain HTML/CSS to avoid Recharts RTL coordinate issues where
// LabelList position="right" overlaps bar starts in dir="rtl" containers.

function PrimaryBarChart({ rows }: { rows: { id: string; name: string; color: string; count: number }[] }) {
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  return (
    <div className="space-y-3 py-1">
      {rows.map(p => (
        <div key={p.id} className="flex items-center gap-3">
          {/* Name + dot — fixed width, truncated with tooltip */}
          <div className="w-48 shrink-0 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span
              className="text-sm font-semibold text-gray-700 leading-tight truncate"
              title={p.name}
            >
              {p.name}
            </span>
          </div>
          {/* Bar — fills inline-start→end (right→left in RTL) */}
          <div className="relative flex-1 h-7 rounded-lg overflow-hidden bg-gray-100">
            <div
              className="absolute inset-y-0 start-0 rounded-lg transition-[width] duration-700 ease-out"
              style={{
                width: `${(p.count / maxCount) * 100}%`,
                backgroundColor: p.color,
                minWidth: p.count > 0 ? 6 : 0,
              }}
            />
          </div>
          {/* Count — outside bar, never overlaps */}
          <span className="w-12 shrink-0 text-sm font-bold text-gray-800 tabular-nums text-end">
            {p.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Excel export ─────────────────────────────────────────────────────────────

function exportToExcel(primaries: PrimaryItem[], totals: { orderCount: number; deliveredCount: number }, dateLabel: string) {
  const totalCount = totals.orderCount;
  const rows = primaries.map(p => ({
    "الحالة الرئيسية": p.name,
    "عدد الطلبات": p.count,
    "تم التوصيل": p.delivered,
    "النسبة %": totalCount > 0 ? parseFloat(((p.count / totalCount) * 100).toFixed(2)) : 0,
  }));
  rows.push({
    "الحالة الرئيسية": "الإجمالي",
    "عدد الطلبات": totals.orderCount,
    "تم التوصيل": totals.deliveredCount,
    "النسبة %": 100,
  });

  const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
  // RTL column order: A=name, B=count, C=delivered, D=pct
  ws["!cols"] = [{ wch: 25 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "تفاصيل الحالات");
  XLSX.writeFile(wb, `تفاصيل_الشحن_${dateLabel || format(new Date(), "yyyy-MM-dd")}.xlsx`);
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function ShippingReportsInner() {
  const router   = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
  const { data, isLoading } = useQuery<{ data: ShippingReportData }>({
    queryKey: ["reports-shipping", qs],
    queryFn: async () => {
      const res = await fetch(`/api/reports/shipping?${qs}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "فشل تحميل تقرير الشحن");
        throw new Error(json.error ?? "fetch error");
      }
      return res.json();
    },
    staleTime: 60_000,
    placeholderData: prev => prev,
  });

  const hasFilters = !!(dateFrom || dateTo);
  const d = data?.data;

  const pieItems = (d?.primaries ?? [])
    .filter(p => p.count > 0)
    .map(p => ({ name: p.name, value: p.count, color: p.color }));

  const pieTotals = pieItems.reduce((s, c) => s + c.value, 0);

  const dateLabel = dateFrom && dateTo ? `${dateFrom}_${dateTo}` : dateFrom || dateTo || "";

  // Safe X-axis tick formatter: guards against Recharts passing a numeric index
  // instead of the date string (happens in edge cases with preserveStartEnd).
  const xTickFormatter = (v: unknown) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
    return v.slice(5); // "MM-DD"
  };

  return (
    <div className="p-6 space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">تقرير الشحن</h1>
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

      {/* Summary KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : d && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Fixed: total orders */}
          <SummaryCard
            title="إجمالي الطلبات"
            value={d.summary.totalOrders.toLocaleString()}
            icon={<Truck className="h-5 w-5 text-indigo-600" />}
            color="bg-indigo-100"
          />
          {/* Fixed: delivered */}
          <SummaryCard
            title="تم التوصيل"
            value={d.summary.deliveredCount.toLocaleString()}
            icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
            color="bg-emerald-100"
          />
          {/* Dynamic: one card per non-delivered primary that has orders */}
          {d.primaries
            .filter(p => p.count > 0 && p.delivered !== p.count)
            .map(p => (
              <SummaryCard
                key={p.id}
                title={p.name}
                value={p.count.toLocaleString()}
                icon={<span className="w-5 h-5 rounded-full inline-block" style={{ backgroundColor: p.color }} />}
                color="bg-gray-100"
              />
            ))}
        </div>
      )}

      {/* Charts */}
      {!isLoading && d && (
        <>
          {/* Daily trend */}
          {d.dailyChart.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">الشحنات حسب اليوم</CardTitle>
                <CardDescription className="text-xs">عدد عمليات الشحن يومياً</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <ResponsiveContainer width="100%" height={260}>
                  {/* margin.top=28 prevents area/dots from touching the card edge above */}
                  <AreaChart data={d.dailyChart} margin={{ top: 28, right: 8, left: -20, bottom: 40 }}>
                    <defs>
                      <linearGradient id="shippingAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.15} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={xTickFormatter}
                      angle={-40}
                      textAnchor="end"
                      height={55}
                      tick={{ fontSize: 11, fontFamily: "IBM Plex Sans Arabic", fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      // Fixed interval: show ~7 evenly-spaced ticks to avoid garbage labels
                      // from Recharts passing numeric indices via "preserveStartEnd".
                      interval={Math.max(0, Math.floor(d.dailyChart.length / 7) - 1)}
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
                      fill="url(#shippingAreaGrad)"
                      name="شحنات"
                      dot={{ r: 3, fill: "#6366f1", strokeWidth: 2, stroke: "#fff" }}
                      activeDot={{ r: 5, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Horizontal bar + Pie row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* CSS bar chart — name | bar | count; labels outside bar fill, RTL-safe */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-0 px-6 pt-6">
                <CardTitle className="text-base font-semibold">الطلبات حسب الحالة الرئيسية</CardTitle>
                <CardDescription className="text-xs">عدد الطلبات لكل حالة رئيسية نشطة</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <PrimaryBarChart rows={d.primaries} />
              </CardContent>
            </Card>

            {pieItems.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-0 px-6 pt-6">
                  <CardTitle className="text-base font-semibold">توزيع الطلبات</CardTitle>
                  <CardDescription className="text-xs">النسبة المئوية لكل حالة رئيسية</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieItems}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        dataKey="value"
                        nameKey="name"
                        paddingAngle={3}
                        isAnimationActive={true}
                      >
                        {pieItems.map((entry, i) => (
                          <Cell key={i} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const item = payload[0];
                          const pct = pieTotals > 0
                            ? Math.round(((item.value as number) / pieTotals) * 100)
                            : 0;
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
                  <PieLegend items={pieItems} />
                </CardContent>
              </Card>
            )}
          </div>

          {/* §12.4: Detail table — all active primaries (including zero-count rows) */}
          {d.primaries.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-6 pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base font-semibold">تفاصيل حسب الحالة الرئيسية</CardTitle>
                    <CardDescription className="text-xs">
                      المصدر: عدد الطلبات الحالية لكل حالة (Order.statusId) — يشمل الحالات بدون طلبات
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 text-xs h-8"
                    onClick={() => exportToExcel(d.primaries, d.totals, dateLabel)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    تصدير Excel
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الحالة الرئيسية</TableHead>
                        <TableHead>عدد الطلبات</TableHead>
                        <TableHead>تم التوصيل</TableHead>
                        <TableHead>نسبة من إجمالي الطلبات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* §12.4: TOTAL summary row first — user sees aggregate before detail */}
                      <TableRow className="bg-muted/60 font-semibold border-b-2">
                        <TableCell>
                          <span className="font-bold text-foreground">الإجمالي</span>
                        </TableCell>
                        <TableCell className="font-bold tabular-nums">
                          {d.totals.orderCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="font-bold tabular-nums">
                          {d.totals.deliveredCount.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-sm font-bold text-foreground tabular-nums"
                            title="مجموع الحالات يساوي ١٠٠٪ من إجمالي الطلبات المصفاة"
                          >
                            {d.totals.orderCount > 0 ? "100%" : "—"}
                          </span>
                        </TableCell>
                      </TableRow>
                      {/* Detail rows — all active primaries, zeros included */}
                      {d.primaries.map(row => {
                        const pct = d.totals.orderCount > 0
                          ? ((row.count / d.totals.orderCount) * 100).toFixed(2)
                          : "0.00";
                        return (
                          <TableRow key={row.id} className={row.count === 0 ? "opacity-50" : ""}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ backgroundColor: row.color }} />
                                <span className="font-medium">{row.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium tabular-nums">{row.count.toLocaleString()}</TableCell>
                            <TableCell className="tabular-nums">{row.delivered.toLocaleString()}</TableCell>
                            <TableCell>
                              {row.count === 0 ? (
                                <span
                                  className="text-xs text-muted-foreground"
                                  title="لا توجد طلبات في هذه الحالة خلال الفترة المحددة"
                                >
                                  —
                                </span>
                              ) : (
                                <span className="text-sm font-semibold text-gray-700 tabular-nums">
                                  {pct}%
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {/* Footnote: percentage definition */}
                <p className="px-4 py-2.5 text-xs text-muted-foreground border-t">
                  * النسبة = عدد طلبات الحالة ÷ إجمالي الطلبات المصفاة × ١٠٠ — الحالات بدون طلبات تظهر بشفافية
                </p>
              </CardContent>
            </Card>
          )}

          {d.primaries.every(p => p.count === 0) && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">لا توجد بيانات للفترة المحددة</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ShippingReportsPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-80" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-72" /><Skeleton className="h-72" />
        </div>
      </div>
    }>
      <ShippingReportsInner />
    </Suspense>
  );
}
