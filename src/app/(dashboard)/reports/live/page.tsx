"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { RefreshCw, Activity, TrendingUp, ShoppingCart, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";
import type { LiveReportData, PeriodStat, StatusInfo } from "@/app/api/reports/live/route";

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<"today" | "yesterday" | "last7days" | "thisMonth", string> = {
  today: "اليوم",
  yesterday: "أمس",
  last7days: "آخر 7 أيام",
  thisMonth: "هذا الشهر",
};

const PERIODS = ["today", "yesterday", "last7days", "thisMonth"] as const;
type PeriodKey = (typeof PERIODS)[number];

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtNumber(n: number) {
  return n.toLocaleString("ar");
}

function fmtRevenue(n: number) {
  if (n === 0) return "٠";
  return n.toLocaleString("ar", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ─── StatusBreakdown ─────────────────────────────────────────────────────────

function StatusBreakdown({
  byStatus,
  statuses,
  compact = false,
}: {
  byStatus: PeriodStat["byStatus"];
  statuses: StatusInfo[];
  compact?: boolean;
}) {
  // Show all statuses, zeroed ones in muted style
  return (
    <div className={cn("space-y-1", compact ? "mt-2" : "mt-3")}>
      {statuses.map((s) => {
        const entry = byStatus.find((b) => b.statusId === s.id);
        const count = entry?.count ?? 0;
        return (
          <div
            key={s.id}
            className={cn(
              "flex items-center justify-between",
              compact ? "text-[11px]" : "text-xs",
              count === 0 && "opacity-40"
            )}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate">{s.name}</span>
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums shrink-0 mr-2",
                count > 0 && "text-foreground"
              )}
            >
              {fmtNumber(count)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── PeriodBlock — used inside employee cards ─────────────────────────────────

function PeriodBlock({
  period,
  stat,
  statuses,
}: {
  period: PeriodKey;
  stat: PeriodStat;
  statuses: StatusInfo[];
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 p-3 cursor-default select-none",
        "transition-all duration-200 ease-in-out",
        "hover:bg-primary/5 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {PERIOD_LABELS[period]}
        </span>
        {stat.count > 0 && (
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: "#22c55e" }}
          />
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none">
          {fmtNumber(stat.count)}
        </span>
        <span className="text-xs text-muted-foreground mb-0.5">طلب</span>
      </div>
      <div className="mt-1 text-sm font-semibold text-primary/80">
        {fmtRevenue(stat.revenue)}
      </div>
      <div className="text-[10px] text-muted-foreground">إجمالي المبيعات</div>
      <StatusBreakdown byStatus={stat.byStatus} statuses={statuses} compact />
    </div>
  );
}

// ─── OverallPeriodCard — top section cards ────────────────────────────────────

function OverallPeriodCard({
  period,
  stat,
  statuses,
  loading,
}: {
  period: PeriodKey;
  stat: PeriodStat | undefined;
  statuses: StatusInfo[];
  loading: boolean;
}) {
  const icons: Record<PeriodKey, React.ReactNode> = {
    today: <Activity className="h-4 w-4 text-primary" />,
    yesterday: <Clock className="h-4 w-4 text-amber-500" />,
    last7days: <TrendingUp className="h-4 w-4 text-blue-500" />,
    thisMonth: <ShoppingCart className="h-4 w-4 text-violet-500" />,
  };

  const accentClasses: Record<PeriodKey, string> = {
    today: "border-primary/30 bg-primary/3",
    yesterday: "border-amber-200 bg-amber-50/50",
    last7days: "border-blue-200 bg-blue-50/50",
    thisMonth: "border-violet-200 bg-violet-50/50",
  };

  if (loading || !stat) {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-28" />
          <div className="space-y-1.5">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "rounded-2xl shadow-sm border transition-shadow duration-200 hover:shadow-lg",
        accentClasses[period]
      )}
    >
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold">{PERIOD_LABELS[period]}</CardTitle>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/70 border border-border/50 shadow-sm">
            {icons[period]}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-4xl font-bold tabular-nums">{fmtNumber(stat.count)}</span>
          <span className="text-sm text-muted-foreground">طلب</span>
        </div>
        <div className="text-lg font-semibold text-primary/90 mb-1">
          {fmtRevenue(stat.revenue)}
        </div>
        <div className="text-xs text-muted-foreground mb-4">إجمالي المبيعات</div>
        <div className="h-px bg-border/60 mb-3" />
        <StatusBreakdown byStatus={stat.byStatus} statuses={statuses} />
      </CardContent>
    </Card>
  );
}

// ─── EmployeeCard ─────────────────────────────────────────────────────────────

function EmployeeCard({
  employee,
  statuses,
}: {
  employee: LiveReportData["employees"][number];
  statuses: StatusInfo[];
}) {
  const hasAnyOrders = PERIODS.some((p) => employee[p].count > 0);

  return (
    <Card className="rounded-2xl shadow-sm border border-border/60 hover:shadow-md transition-shadow duration-200">
      {/* Employee header */}
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-bold truncate">{employee.name}</CardTitle>
            {!hasAnyOrders && (
              <p className="text-xs text-muted-foreground mt-0.5">لا توجد طلبات في الفترات المحددة</p>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px] font-medium px-2 py-0.5">
            {ROLE_LABELS[employee.role as Role] ?? employee.role}
          </Badge>
        </div>
      </CardHeader>

      {/* Period blocks 2×2 grid */}
      <CardContent className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-2.5">
          {PERIODS.map((p) => (
            <PeriodBlock key={p} period={p} stat={employee[p]} statuses={statuses} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton for employee cards ──────────────────────────────────────────────

function EmployeeCardSkeleton() {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border p-3 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

function LiveReportPageInner() {
  const {
    data,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery<{ data: LiveReportData }>({
    queryKey: ["live-report"],
    queryFn: () => fetch("/api/reports/live").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const report = data?.data;
  const updatedAt = dataUpdatedAt
    ? format(new Date(dataUpdatedAt), "HH:mm:ss", { locale: arSA })
    : null;

  return (
    <div className="p-6 space-y-8" dir="rtl">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            تقرير Live
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            إحصائيات الطلبات والمبيعات لحظةً بلحظة
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
              آخر تحديث: {updatedAt}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            تحديث التقرير
          </Button>
        </div>
      </div>

      {/* ── Overall statistics section ── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          الإجماليات العامة
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PERIODS.map((p) => (
            <OverallPeriodCard
              key={p}
              period={p}
              stat={report?.overall[p]}
              statuses={report?.statuses ?? []}
              loading={isLoading}
            />
          ))}
        </div>
      </section>

      {/* ── Employee section ── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          أداء الموظفين
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {[1, 2, 3, 4].map((i) => <EmployeeCardSkeleton key={i} />)}
          </div>
        ) : !report?.employees.length ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 p-12 text-muted-foreground">
            لا توجد بيانات متاحة حالياً
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {report.employees.map((emp) => (
              <EmployeeCard key={emp.id} employee={emp} statuses={report.statuses} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function LiveReportPage() {
  return (
    <Suspense>
      <LiveReportPageInner />
    </Suspense>
  );
}
