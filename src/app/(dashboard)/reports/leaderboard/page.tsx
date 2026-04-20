"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Trophy, CalendarIcon, Users, TrendingUp, ShoppingCart } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type CurrencyAmount = {
  id: string; code: string; symbol: string; total: number;
};

type LeaderboardEntry = {
  rank: number;
  userId: string;
  name: string;
  team: { id: string; name: string } | null;
  orderCount: number;
  revenueByCurrency: CurrencyAmount[];
  targetOrders: number | null;
  targetAchievement: number | null;
};

type LeaderboardData = {
  entries: LeaderboardEntry[];
  periodStart: string;
  periodEnd: string;
};

type Team = { id: string; name: string };

// ─── Rank badge (medal colours) ───────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1 ? "bg-yellow-400 text-yellow-900 ring-2 ring-yellow-300" :
    rank === 2 ? "bg-slate-300  text-slate-800  ring-2 ring-slate-200" :
    rank === 3 ? "bg-amber-600  text-white       ring-2 ring-amber-400" :
                 "bg-muted      text-muted-foreground";
  const size = rank <= 3 ? "h-9 w-9 text-base" : "h-7 w-7 text-sm";
  return (
    <span className={cn(
      "inline-flex items-center justify-center rounded-full font-bold shrink-0",
      cls, size,
    )}>
      {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
    </span>
  );
}

// ─── Achievement pill ─────────────────────────────────────────────────────────

function AchievementPill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">—</span>;
  const color =
    pct >= 100 ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
    pct >= 80  ? "bg-green-100   text-green-800   border-green-200" :
    pct >= 50  ? "bg-yellow-100  text-yellow-800  border-yellow-200" :
                 "bg-red-100     text-red-800     border-red-200";
  return (
    <Badge variant="outline" className={cn("text-xs font-semibold", color)}>
      {pct}%
    </Badge>
  );
}

// ─── Inner component ──────────────────────────────────────────────────────────

function LeaderboardInner() {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen]     = useState(false);

  const dateFrom   = searchParams.get("dateFrom") ?? "";
  const dateTo     = searchParams.get("dateTo")   ?? "";
  const filterTeam = searchParams.get("teamId")   ?? "";

  const updateParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.replace(`${pathname}?${p.toString()}`);
  };

  const canFilterTeam = role === "ADMIN" || role === "GENERAL_MANAGER";

  const { data: teamsData } = useQuery<{ data: Team[] }>({
    queryKey: ["teams-lookup"],
    queryFn: () => fetch("/api/lookup/teams").then((r) => r.json()),
    enabled: canFilterTeam,
  });
  const teams: Team[] = teamsData?.data ?? [];

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: LeaderboardData }>({
    queryKey: ["leaderboard", qs],
    queryFn: () => fetch(`/api/reports/leaderboard?${qs}`).then((r) => r.json()),
    placeholderData: (prev) => prev,
  });

  const board   = data?.data;
  const entries = board?.entries ?? [];

  // Collect all currency codes present so we can render dynamic columns
  const currencyCodes = [...new Set(
    entries.flatMap((e) => e.revenueByCurrency.map((c) => c.code)),
  )].sort();

  const topThree = entries.slice(0, 3);

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-amber-100">
          <Trophy className="h-6 w-6 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الترتيب</h1>
          <p className="text-sm text-muted-foreground">
            ترتيب موظفي المبيعات حسب الطلبات المسلَّمة
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">من تاريخ</Label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span className={dateFrom ? "" : "text-muted-foreground"}>
                    {dateFrom || "بداية الشهر"}
                  </span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateFrom ? new Date(dateFrom) : undefined}
                    onDayClick={(d) => { updateParam("dateFrom", format(d, "yyyy-MM-dd")); setDateFromOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">إلى تاريخ</Label>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span className={dateTo ? "" : "text-muted-foreground"}>
                    {dateTo || "نهاية الشهر"}
                  </span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateTo ? new Date(dateTo) : undefined}
                    onDayClick={(d) => { updateParam("dateTo", format(d, "yyyy-MM-dd")); setDateToOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {canFilterTeam && (
              <div className="space-y-1.5">
                <Label className="text-xs">الفريق</Label>
                <SearchableSelect
                  options={[
                    { value: "", label: "كل الفرق" },
                    ...teams.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  value={filterTeam}
                  onChange={(v) => updateParam("teamId", v || null)}
                  placeholder="كل الفرق"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Period label */}
      {board && (
        <p className="text-xs text-muted-foreground">
          الفترة:{" "}
          {format(new Date(board.periodStart), "dd MMMM yyyy", { locale: arSA })}
          {" — "}
          {format(new Date(board.periodEnd), "dd MMMM yyyy", { locale: arSA })}
        </p>
      )}

      {/* Top-3 podium cards */}
      {!isLoading && topThree.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {topThree.map((entry) => {
            const podiumColors = [
              "from-yellow-50 to-amber-50   border-yellow-200",
              "from-slate-50  to-gray-50    border-slate-200",
              "from-orange-50 to-amber-50   border-amber-200",
            ];
            return (
              <Card
                key={entry.userId}
                className={cn(
                  "border-2 bg-gradient-to-br",
                  podiumColors[entry.rank - 1],
                )}
              >
                <CardContent className="p-5 text-center space-y-3">
                  <div className="flex justify-center">
                    <RankBadge rank={entry.rank} />
                  </div>
                  <div>
                    <p className="font-bold text-base">{entry.name}</p>
                    {entry.team && (
                      <p className="text-xs text-muted-foreground">{entry.team.name}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1.5">
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    <span className="text-2xl font-extrabold tracking-tight">
                      {entry.orderCount}
                    </span>
                    <span className="text-xs text-muted-foreground">طلب</span>
                  </div>
                  {entry.revenueByCurrency.length > 0 && (
                    <div className="space-y-0.5">
                      {entry.revenueByCurrency.map((c) => (
                        <p key={c.id} className="text-xs font-semibold text-muted-foreground">
                          {c.total.toLocaleString()} {c.code}
                        </p>
                      ))}
                    </div>
                  )}
                  {entry.targetAchievement !== null && (
                    <AchievementPill pct={entry.targetAchievement} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-20 text-center space-y-2">
            <Trophy className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-muted-foreground">لا توجد طلبات مسلَّمة في هذه الفترة</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2 px-6 pt-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" />
                جدول الترتيب الكامل
              </CardTitle>
              <CardDescription className="text-xs">
                {entries.length} موظف
              </CardDescription>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-4 py-3 text-right font-medium w-16">#</th>
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-right font-medium">الفريق</th>
                  <th className="px-4 py-3 text-center font-medium">
                    <span className="flex items-center justify-center gap-1">
                      <ShoppingCart className="h-3.5 w-3.5" />
                      الطلبات
                    </span>
                  </th>
                  {currencyCodes.map((code) => (
                    <th key={code} className="px-4 py-3 text-end font-medium">
                      المبيعات ({code})
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-medium">
                    <span className="flex items-center justify-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      التارجت
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr
                    key={entry.userId}
                    className={cn(
                      "border-b transition-colors hover:bg-muted/30",
                      i % 2 === 0 ? "bg-background" : "bg-muted/10",
                      entry.rank <= 3 && "bg-amber-50/40 hover:bg-amber-50/60",
                    )}
                  >
                    <td className="px-4 py-3">
                      <RankBadge rank={entry.rank} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{entry.name}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {entry.team?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-base tabular-nums">
                        {entry.orderCount}
                      </span>
                    </td>
                    {currencyCodes.map((code) => {
                      const rev = entry.revenueByCurrency.find((c) => c.code === code);
                      return (
                        <td key={code} className="px-4 py-3 text-end font-mono text-sm">
                          {rev ? rev.total.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <AchievementPill pct={entry.targetAchievement} />
                        {entry.targetOrders !== null && (
                          <span className="text-[10px] text-muted-foreground">
                            {entry.orderCount}/{entry.targetOrders}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    }>
      <LeaderboardInner />
    </Suspense>
  );
}
