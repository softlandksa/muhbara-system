"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { CalendarIcon, Target, TrendingUp, Users, CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TargetRow = {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  targetDeliveredOrderCount: number | null;
  targetRevenue: number | null;
  notes: string | null;
  achievedDelivered: number;
  orderPct: number | null;
  user: {
    id: string;
    name: string;
    role: Role;
    teamId: string | null;
    team: { id: string; name: string } | null;
  };
  currency: { id: string; code: string; symbol: string } | null;
};

type LookupUser = { id: string; name: string; role: Role };

// ─── Progress Card ────────────────────────────────────────────────────────────

function TargetCard({ t }: { t: TargetRow }) {
  const pct = t.orderPct;
  const barColor =
    pct === null ? "bg-gray-300" :
    pct >= 100 ? "bg-emerald-500" :
    pct >= 80  ? "bg-green-500" :
    pct >= 50  ? "bg-yellow-400" : "bg-red-400";
  const textColor =
    pct === null ? "text-gray-400" :
    pct >= 100 ? "text-emerald-700" :
    pct >= 80  ? "text-green-700" :
    pct >= 50  ? "text-yellow-700" : "text-red-600";
  const borderColor =
    pct === null ? "border-gray-200" :
    pct >= 100 ? "border-emerald-300" :
    pct >= 80  ? "border-green-200" :
    pct >= 50  ? "border-yellow-200" : "border-red-200";

  return (
    <Card className={cn("border-2", borderColor)}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{t.user.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[t.user.role]}</p>
            {t.user.team && (
              <p className="text-xs text-muted-foreground">{t.user.team.name}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            {pct !== null ? (
              <span className={cn("text-2xl font-bold", textColor)}>{pct}%</span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        </div>

        {/* Period */}
        <p className="text-xs text-muted-foreground">
          {format(new Date(t.periodStart), "dd/MM/yyyy", { locale: arSA })}
          {" — "}
          {format(new Date(t.periodEnd), "dd/MM/yyyy", { locale: arSA })}
        </p>

        {/* Progress bar */}
        {t.targetDeliveredOrderCount !== null && t.targetDeliveredOrderCount > 0 ? (
          <div className="space-y-1">
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", barColor)}
                style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>الفعلي: {t.achievedDelivered} طلب</span>
              <span>التارجت: {t.targetDeliveredOrderCount} طلب</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            الطلبات المسلمة: {t.achievedDelivered}
            {t.targetDeliveredOrderCount === null && " (لم يُحدد تارجت)"}
          </p>
        )}

        {/* Revenue target */}
        {t.targetRevenue !== null && (
          <div className="pt-2 border-t flex items-center justify-between text-sm">
            <span className="text-muted-foreground">هدف الإيراد</span>
            <span className="font-medium">
              {t.targetRevenue.toLocaleString()} {t.currency?.code ?? ""}
            </span>
          </div>
        )}

        {/* Notes */}
        {t.notes && (
          <p className="text-xs text-muted-foreground border-t pt-2 line-clamp-2">{t.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function TargetsReportInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;

  const isAdminOrGM = role === "ADMIN" || role === "GENERAL_MANAGER";
  const isSalesManager = role === "SALES_MANAGER";
  const canFilterUsers = isAdminOrGM;
  const canFilterTeam = isAdminOrGM;

  const periodStart = searchParams.get("periodStart") ?? "";
  const periodEnd   = searchParams.get("periodEnd")   ?? "";
  const filterUserId = searchParams.get("userId")     ?? "";
  const filterTeamId = searchParams.get("teamId")     ?? "";

  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen,   setToOpen]   = useState(false);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: users = [] } = useQuery<LookupUser[]>({
    queryKey: ["lookup-users-targets-report"],
    queryFn: () => fetch("/api/lookup/users").then(r => r.json()).then(r => r.data ?? []),
    enabled: canFilterUsers,
  });

  const { data: teams = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["lookup-teams"],
    queryFn: () => fetch("/api/lookup/teams").then(r => r.json()).then(r => r.data ?? []),
    enabled: canFilterTeam,
  });

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: TargetRow[] }>({
    queryKey: ["reports-targets", qs],
    queryFn: () => fetch(`/api/reports/targets?${qs}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  const targets = data?.data ?? [];

  // Summary stats
  const withPct     = targets.filter(t => t.orderPct !== null);
  const avgPct      = withPct.length > 0
    ? Math.round(withPct.reduce((s, t) => s + (t.orderPct ?? 0), 0) / withPct.length)
    : null;
  const completed   = withPct.filter(t => (t.orderPct ?? 0) >= 100).length;
  const above80     = withPct.filter(t => (t.orderPct ?? 0) >= 80).length;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Target className="h-6 w-6" />
          تقرير التارجت
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdminOrGM
            ? "نسب تحقيق التارجت لجميع الموظفين"
            : isSalesManager
            ? "نسب تحقيق التارجت لأعضاء فريقك"
            : "نسبة تحقيقك للتارجت المحدد"}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Period start */}
            <div className="space-y-1.5">
              <Label className="text-xs">بداية الفترة</Label>
              <Popover open={fromOpen} onOpenChange={setFromOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{periodStart || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={periodStart ? new Date(periodStart) : undefined}
                    onDayClick={d => { updateParam("periodStart", format(d, "yyyy-MM-dd")); setFromOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Period end */}
            <div className="space-y-1.5">
              <Label className="text-xs">نهاية الفترة</Label>
              <Popover open={toOpen} onOpenChange={setToOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{periodEnd || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={periodEnd ? new Date(periodEnd) : undefined}
                    onDayClick={d => { updateParam("periodEnd", format(d, "yyyy-MM-dd")); setToOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* User filter (ADMIN/GM only) */}
            {canFilterUsers && (
              <div className="space-y-1.5">
                <Label className="text-xs">الموظف</Label>
                <SearchableSelect
                  options={[
                    { value: "", label: "كل الموظفين" },
                    ...users.map(u => ({
                      value: u.id,
                      label: u.name,
                      sublabel: ROLE_LABELS[u.role],
                    })),
                  ]}
                  value={filterUserId}
                  onChange={v => updateParam("userId", v || null)}
                  placeholder="كل الموظفين"
                />
              </div>
            )}

            {/* Team filter (ADMIN/GM only) */}
            {canFilterTeam && (
              <div className="space-y-1.5">
                <Label className="text-xs">الفريق</Label>
                <SearchableSelect
                  options={[
                    { value: "", label: "كل الفرق" },
                    ...teams.map(t => ({ value: t.id, label: t.name })),
                  ]}
                  value={filterTeamId}
                  onChange={v => updateParam("teamId", v || null)}
                  placeholder="كل الفرق"
                />
              </div>
            )}
          </div>

          {/* Clear filters */}
          {(periodStart || periodEnd || filterUserId || filterTeamId) && (
            <button
              onClick={() => router.replace(pathname)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
            >
              مسح الفلاتر
            </button>
          )}
        </CardContent>
      </Card>

      {/* Summary stats */}
      {!isLoading && targets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: "إجمالي التارجتات",
              value: targets.length,
              icon: <Target className="h-5 w-5 text-blue-500" />,
              color: "text-blue-700",
            },
            {
              label: "متوسط التحقيق",
              value: avgPct !== null ? `${avgPct}%` : "—",
              icon: <TrendingUp className="h-5 w-5 text-purple-500" />,
              color: avgPct === null ? "text-gray-600"
                   : avgPct >= 80   ? "text-green-700"
                   : avgPct >= 50   ? "text-yellow-700"
                   : "text-red-600",
            },
            {
              label: "حققوا ≥80%",
              value: above80,
              icon: <Users className="h-5 w-5 text-green-500" />,
              color: "text-green-700",
            },
            {
              label: "حققوا 100%+",
              value: completed,
              icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
              color: "text-emerald-700",
            },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="shrink-0">{s.icon}</div>
                <div>
                  <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : targets.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>لا توجد تارجتات لعرضها</p>
          {(periodStart || periodEnd) && (
            <p className="text-sm mt-1">جرب تغيير الفترة أو مسح الفلاتر</p>
          )}
        </div>
      ) : (
        <>
          {/* Group by period if multiple periods exist */}
          {(() => {
            const periodMap = new Map<string, TargetRow[]>();
            for (const t of targets) {
              const key = `${t.periodStart}__${t.periodEnd}`;
              if (!periodMap.has(key)) periodMap.set(key, []);
              periodMap.get(key)!.push(t);
            }
            const periods = Array.from(periodMap.entries());

            if (periods.length === 1) {
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {periods[0][1].map(t => <TargetCard key={t.id} t={t} />)}
                </div>
              );
            }

            return periods.map(([key, rows]) => {
              const [ps, pe] = key.split("__");
              return (
                <div key={key} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {format(new Date(ps), "dd/MM/yyyy", { locale: arSA })}
                      {" — "}
                      {format(new Date(pe), "dd/MM/yyyy", { locale: arSA })}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{rows.length} تارجت</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {rows.map(t => <TargetCard key={t.id} t={t} />)}
                  </div>
                </div>
              );
            });
          })()}
        </>
      )}
    </div>
  );
}

export default function TargetsReportPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <TargetsReportInner />
    </Suspense>
  );
}
