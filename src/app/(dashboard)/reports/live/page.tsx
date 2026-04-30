"use client";

import { type ReactNode, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { RefreshCw, Activity, TrendingUp, ShoppingCart, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";
import type { LiveReportData, PeriodStat, StatusInfo } from "@/app/api/reports/live/route";

// ─── Period keys & labels ─────────────────────────────────────────────────────

const PERIODS = ["today", "yesterday", "last7days", "thisMonth"] as const;
type PeriodKey = (typeof PERIODS)[number];

// ─── Centralized period color / theme map ─────────────────────────────────────
//
// All Tailwind class names are written as full literal strings here so the JIT
// scanner picks them up correctly (no dynamic concatenation).

type PeriodThemeConfig = {
  label: string;
  icon: ReactNode;
  // ── Top summary card ──
  cardBg: string;       // gradient background classes
  cardBorder: string;   // border color class
  iconWrap: string;     // icon container bg + border
  countCls: string;     // large order-count text color
  revenueCls: string;   // revenue amount text color
  divider: string;      // horizontal divider bg color
  // ── Employee period block (inside employee card) ──
  blockBase: string;    // resting background + border
  blockHover: string;   // hover state classes (bg, border, shadow, lift)
  labelCls: string;     // period label text color inside block
  blockCount: string;   // count number text color inside block
  blockRevenue: string; // revenue text color inside block
  dot: string;          // activity indicator dot color
};

const PERIOD_THEME: Record<PeriodKey, PeriodThemeConfig> = {
  today: {
    label: "اليوم",
    icon: <Activity className="h-4 w-4 text-sky-600" />,
    cardBg: "bg-gradient-to-br from-sky-50 to-white",
    cardBorder: "border-sky-200",
    iconWrap: "bg-sky-100 border border-sky-200",
    countCls: "text-sky-950",
    revenueCls: "text-sky-600",
    divider: "bg-sky-100",
    blockBase: "bg-sky-50/60 border-sky-200/60",
    blockHover: "hover:bg-sky-100/90 hover:border-sky-300 hover:shadow-md hover:-translate-y-0.5",
    labelCls: "text-sky-600",
    blockCount: "text-sky-900",
    blockRevenue: "text-sky-700",
    dot: "bg-sky-400",
  },
  yesterday: {
    label: "أمس",
    icon: <Clock className="h-4 w-4 text-violet-600" />,
    cardBg: "bg-gradient-to-br from-violet-50 to-white",
    cardBorder: "border-violet-200",
    iconWrap: "bg-violet-100 border border-violet-200",
    countCls: "text-violet-950",
    revenueCls: "text-violet-600",
    divider: "bg-violet-100",
    blockBase: "bg-violet-50/60 border-violet-200/60",
    blockHover: "hover:bg-violet-100/90 hover:border-violet-300 hover:shadow-md hover:-translate-y-0.5",
    labelCls: "text-violet-600",
    blockCount: "text-violet-900",
    blockRevenue: "text-violet-700",
    dot: "bg-violet-400",
  },
  last7days: {
    label: "آخر 7 أيام",
    icon: <TrendingUp className="h-4 w-4 text-emerald-600" />,
    cardBg: "bg-gradient-to-br from-emerald-50 to-white",
    cardBorder: "border-emerald-200",
    iconWrap: "bg-emerald-100 border border-emerald-200",
    countCls: "text-emerald-950",
    revenueCls: "text-emerald-600",
    divider: "bg-emerald-100",
    blockBase: "bg-emerald-50/60 border-emerald-200/60",
    blockHover: "hover:bg-emerald-100/90 hover:border-emerald-300 hover:shadow-md hover:-translate-y-0.5",
    labelCls: "text-emerald-600",
    blockCount: "text-emerald-900",
    blockRevenue: "text-emerald-700",
    dot: "bg-emerald-400",
  },
  thisMonth: {
    label: "هذا الشهر",
    icon: <ShoppingCart className="h-4 w-4 text-amber-600" />,
    cardBg: "bg-gradient-to-br from-amber-50 to-white",
    cardBorder: "border-amber-200",
    iconWrap: "bg-amber-100 border border-amber-200",
    countCls: "text-amber-950",
    revenueCls: "text-amber-600",
    divider: "bg-amber-100",
    blockBase: "bg-amber-50/60 border-amber-200/60",
    blockHover: "hover:bg-amber-100/90 hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5",
    labelCls: "text-amber-600",
    blockCount: "text-amber-900",
    blockRevenue: "text-amber-700",
    dot: "bg-amber-400",
  },
};

// ─── Rotating accent palette for employee cards ───────────────────────────────
//
// Index 0 = sky, 1 = violet, 2 = emerald, 3 = amber, 4 = rose, 5 = indigo
// Cycles back for > 6 employees.

type EmployeeAccent = {
  cardBorder: string;
  headerBg: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
};

const EMPLOYEE_ACCENTS: EmployeeAccent[] = [
  { cardBorder: "border-sky-200",     headerBg: "bg-sky-50/50",     badgeBg: "bg-sky-100",     badgeText: "text-sky-700",     badgeBorder: "border-sky-200"     },
  { cardBorder: "border-violet-200",  headerBg: "bg-violet-50/50",  badgeBg: "bg-violet-100",  badgeText: "text-violet-700",  badgeBorder: "border-violet-200"  },
  { cardBorder: "border-emerald-200", headerBg: "bg-emerald-50/50", badgeBg: "bg-emerald-100", badgeText: "text-emerald-700", badgeBorder: "border-emerald-200" },
  { cardBorder: "border-amber-200",   headerBg: "bg-amber-50/50",   badgeBg: "bg-amber-100",   badgeText: "text-amber-700",   badgeBorder: "border-amber-200"   },
  { cardBorder: "border-rose-200",    headerBg: "bg-rose-50/50",    badgeBg: "bg-rose-100",    badgeText: "text-rose-700",    badgeBorder: "border-rose-200"    },
  { cardBorder: "border-indigo-200",  headerBg: "bg-indigo-50/50",  badgeBg: "bg-indigo-100",  badgeText: "text-indigo-700",  badgeBorder: "border-indigo-200"  },
];

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtNumber(n: number) {
  return n.toLocaleString("ar");
}

function fmtRevenue(n: number) {
  if (n === 0) return "٠";
  return n.toLocaleString("ar", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ─── StatusBreakdown ─────────────────────────────────────────────────────────
//
// Uses the status colors stored in the DB (via the status.color field).
// Period color is NOT applied here — the DB colors are the semantic signal.

function StatusBreakdown({
  byStatus,
  statuses,
  compact = false,
}: {
  byStatus: PeriodStat["byStatus"];
  statuses: StatusInfo[];
  compact?: boolean;
}) {
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
              count === 0 && "opacity-35"
            )}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate">{s.name}</span>
            </span>
            <span className={cn("font-semibold tabular-nums shrink-0 mr-2", count > 0 && "text-foreground")}>
              {fmtNumber(count)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── PeriodBlock ─────────────────────────────────────────────────────────────
//
// Used inside employee cards. Each block matches the color of its corresponding
// top summary card via PERIOD_THEME.

function PeriodBlock({
  period,
  stat,
  statuses,
}: {
  period: PeriodKey;
  stat: PeriodStat;
  statuses: StatusInfo[];
}) {
  const t = PERIOD_THEME[period];

  return (
    <div
      className={cn(
        "rounded-xl border p-3 cursor-default select-none",
        "transition-all duration-200 ease-in-out",
        t.blockBase,
        t.blockHover
      )}
    >
      {/* Period label + activity dot */}
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", t.labelCls)}>
          {t.label}
        </span>
        {stat.count > 0 && (
          <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", t.dot)} />
        )}
      </div>

      {/* Order count */}
      <div className="flex items-end gap-1.5">
        <span className={cn("text-2xl font-bold tabular-nums leading-none", t.blockCount)}>
          {fmtNumber(stat.count)}
        </span>
        <span className="text-xs text-muted-foreground mb-0.5">طلب</span>
      </div>

      {/* Revenue */}
      <div className={cn("mt-1 text-sm font-semibold", t.blockRevenue)}>
        {fmtRevenue(stat.revenue)}
      </div>
      <div className="text-[10px] text-muted-foreground">إجمالي المبيعات</div>

      <StatusBreakdown byStatus={stat.byStatus} statuses={statuses} compact />
    </div>
  );
}

// ─── OverallPeriodCard ────────────────────────────────────────────────────────
//
// The four large summary cards at the top of the page.

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
  const t = PERIOD_THEME[period];

  if (loading || !stat) {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2 pt-4 px-5">
          <Skeleton className="h-5 w-20" />
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-px w-full" />
          <div className="space-y-1.5 pt-1">
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
        t.cardBg,
        t.cardBorder
      )}
    >
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold">{t.label}</CardTitle>
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shadow-sm", t.iconWrap)}>
            {t.icon}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5">
        {/* Order count */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className={cn("text-4xl font-bold tabular-nums", t.countCls)}>
            {fmtNumber(stat.count)}
          </span>
          <span className="text-sm text-muted-foreground">طلب</span>
        </div>

        {/* Revenue */}
        <div className={cn("text-lg font-semibold mb-1", t.revenueCls)}>
          {fmtRevenue(stat.revenue)}
        </div>
        <div className="text-xs text-muted-foreground mb-4">إجمالي المبيعات</div>

        {/* Divider */}
        <div className={cn("h-px mb-3", t.divider)} />

        <StatusBreakdown byStatus={stat.byStatus} statuses={statuses} />
      </CardContent>
    </Card>
  );
}

// ─── EmployeeCard ─────────────────────────────────────────────────────────────
//
// Receives `index` so the accent color rotates through the palette.
// Period blocks inside use the same PERIOD_THEME as the top summary cards.

function EmployeeCard({
  employee,
  statuses,
  index,
}: {
  employee: LiveReportData["employees"][number];
  statuses: StatusInfo[];
  index: number;
}) {
  const accent = EMPLOYEE_ACCENTS[index % EMPLOYEE_ACCENTS.length];
  const hasAnyOrders = PERIODS.some((p) => employee[p].count > 0);

  return (
    <Card
      className={cn(
        "rounded-2xl shadow-sm border transition-shadow duration-200 hover:shadow-md",
        accent.cardBorder
      )}
    >
      {/* Employee header — tinted with accent color */}
      <CardHeader className={cn("pb-3 pt-4 px-5 rounded-t-2xl", accent.headerBg)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base font-bold truncate">{employee.name}</CardTitle>
            {!hasAnyOrders && (
              <p className="text-xs text-muted-foreground mt-0.5">
                لا توجد طلبات في الفترات المحددة
              </p>
            )}
          </div>
          {/* Role badge — styled with accent color */}
          <span
            className={cn(
              "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5",
              "text-[10px] font-semibold border",
              accent.badgeBg,
              accent.badgeText,
              accent.badgeBorder
            )}
          >
            {ROLE_LABELS[employee.role as Role] ?? employee.role}
          </span>
        </div>
      </CardHeader>

      {/* Period blocks — 2 × 2 grid, each colored by PERIOD_THEME */}
      <CardContent className="px-5 pb-5 pt-4">
        <div className="grid grid-cols-2 gap-2.5">
          {PERIODS.map((p) => (
            <PeriodBlock key={p} period={p} stat={employee[p]} statuses={statuses} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Loading skeleton for employee cards ──────────────────────────────────────

function EmployeeCardSkeleton() {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-4">
        <div className="grid grid-cols-2 gap-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border p-3 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-3 w-20" />
              <div className="space-y-1 pt-1">
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function LiveReportPageInner() {
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } =
    useQuery<{ data: LiveReportData }>({
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
      {/* ── Page header ── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-sky-600" />
            تقرير Live
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            إحصائيات الطلبات والمبيعات لحظةً بلحظة
          </p>
        </div>
        <div className="flex items-center gap-3 mt-2 sm:mt-0">
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

      {/* ── Overall summary cards ── */}
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

      {/* ── Employee performance cards ── */}
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
            {report.employees.map((emp, i) => (
              <EmployeeCard
                key={emp.id}
                employee={emp}
                statuses={report.statuses}
                index={i}
              />
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
