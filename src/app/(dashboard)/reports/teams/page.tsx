"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  UsersRound, Users, ShoppingCart, CheckCircle, TrendingUp,
  Filter, X, CalendarIcon, ChevronDown, ChevronUp, ArrowLeft,
  Trophy, Loader2,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PerformanceCard } from "@/components/shared/PerformanceCard";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TeamStat = {
  id: string;
  name: string;
  manager: { id: string; name: string };
  memberCount: number;
  totalOrders: number;
  delivered: number;
  shipped: number;
  returned: number;
  cancelled: number;
  deliveryRate: number;
  revenueByCurrency: { currencyCode: string; total: number }[];
};

type StatusItem = { id: string; name: string; color: string };
type Country    = { id: string; name: string };
type Currency   = { id: string; code: string; name: string };

type MemberSale = { userId: string; rank: number; total: number; orderCount: number };
type SalesByCurrency = { currencyCode: string; members: MemberSale[] };
type StatusMatrixRow = { userId: string; total: number; counts: Record<string, number> };
type TeamMembersData = {
  members: { id: string; name: string }[];
  salesByCurrency: SalesByCurrency[];
  statusMatrix: { statuses: StatusItem[]; rows: StatusMatrixRow[] };
};

// ─── Filters ─────────────────────────────────────────────────────────────────

type Filters = {
  dateFrom: string; dateTo: string;
  statuses: string[]; countryIds: string[]; currencyId: string;
};
const DEFAULT_FILTERS: Filters = {
  dateFrom: "", dateTo: "", statuses: [], countryIds: [], currencyId: "",
};

// ─── Shared tab bar ───────────────────────────────────────────────────────────

function ReportsTabs({ active }: { active: "teams" | "employees" }) {
  const tabs = [
    { key: "teams",     label: "أداء الفرق",        href: "/reports/teams"     },
    { key: "employees", label: "تقارير الموظفين",    href: "/reports/employees" },
  ] as const;
  return (
    <div className="flex gap-0 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
            active === t.key
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

// ─── Filters bar ─────────────────────────────────────────────────────────────

function FiltersBar({
  filters, onChange, countries, currencies, statuses,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  countries: Country[];
  currencies: Currency[];
  statuses: StatusItem[];
}) {
  const [dfOpen, setDfOpen] = useState(false);
  const [dtOpen, setDtOpen] = useState(false);
  const [stOpen, setStOpen] = useState(false);
  const [coOpen, setCoOpen] = useState(false);

  const hasFilters = filters.dateFrom || filters.dateTo || filters.statuses.length > 0
    || filters.countryIds.length > 0 || filters.currencyId;

  return (
    <div className="flex flex-wrap items-center gap-2 p-4 rounded-xl border bg-muted/20">
      {/* Date From */}
      <Popover open={dfOpen} onOpenChange={setDfOpen}>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm hover:bg-muted">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {filters.dateFrom || "من تاريخ"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar mode="single" selected={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
            onDayClick={(d) => { onChange({ ...filters, dateFrom: format(d,"yyyy-MM-dd") }); setDfOpen(false); }} />
        </PopoverContent>
      </Popover>

      {/* Date To */}
      <Popover open={dtOpen} onOpenChange={setDtOpen}>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm hover:bg-muted">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {filters.dateTo || "إلى تاريخ"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar mode="single" selected={filters.dateTo ? new Date(filters.dateTo) : undefined}
            onDayClick={(d) => { onChange({ ...filters, dateTo: format(d,"yyyy-MM-dd") }); setDtOpen(false); }} />
        </PopoverContent>
      </Popover>

      {/* Status */}
      <Popover open={stOpen} onOpenChange={setStOpen}>
        <PopoverTrigger className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted",
          filters.statuses.length > 0 ? "border-primary bg-primary/5 text-primary" : "border-input bg-background"
        )}>
          <Filter className="h-3.5 w-3.5" />الحالة
          {filters.statuses.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{filters.statuses.length}</Badge>}
        </PopoverTrigger>
        <PopoverContent className="w-52 p-3 space-y-1.5" align="start">
          {statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <Checkbox id={`fs-${s.id}`} checked={filters.statuses.includes(s.id)}
                onCheckedChange={() => {
                  const next = filters.statuses.includes(s.id)
                    ? filters.statuses.filter((x) => x !== s.id)
                    : [...filters.statuses, s.id];
                  onChange({ ...filters, statuses: next });
                }} />
              <label htmlFor={`fs-${s.id}`} className="text-xs cursor-pointer">{s.name}</label>
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {/* Country */}
      {countries.length > 0 && (
        <Popover open={coOpen} onOpenChange={setCoOpen}>
          <PopoverTrigger className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted",
            filters.countryIds.length > 0 ? "border-primary bg-primary/5 text-primary" : "border-input bg-background"
          )}>
            <Filter className="h-3.5 w-3.5" />الدولة
            {filters.countryIds.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{filters.countryIds.length}</Badge>}
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 space-y-1.5 max-h-64 overflow-y-auto" align="start">
            {countries.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox id={`fc-${c.id}`} checked={filters.countryIds.includes(c.id)}
                  onCheckedChange={() => {
                    const next = filters.countryIds.includes(c.id)
                      ? filters.countryIds.filter((x) => x !== c.id)
                      : [...filters.countryIds, c.id];
                    onChange({ ...filters, countryIds: next });
                  }} />
                <label htmlFor={`fc-${c.id}`} className="text-xs cursor-pointer">{c.name}</label>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {/* Currency */}
      {currencies.length > 0 && (
        <select
          value={filters.currencyId}
          onChange={(e) => onChange({ ...filters, currencyId: e.target.value })}
          className="h-8 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">كل العملات</option>
          {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      )}

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground"
          onClick={() => onChange(DEFAULT_FILTERS)}>
          <X className="h-3.5 w-3.5" />مسح
        </Button>
      )}
    </div>
  );
}

// ─── Team Expansion Panel ─────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1 ? "bg-yellow-400 text-yellow-900" :
    rank === 2 ? "bg-slate-300  text-slate-700"  :
    rank === 3 ? "bg-amber-600  text-white"       :
                 "bg-muted      text-muted-foreground";
  return (
    <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shrink-0", cls)}>
      {rank}
    </span>
  );
}

function TeamExpansionPanel({
  team, filters, onClose, teamOrdersHref,
}: {
  team: TeamStat;
  filters: Filters;
  onClose: () => void;
  teamOrdersHref: string;
}) {
  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo)   p.set("dateTo",   filters.dateTo);
    filters.statuses.forEach((s) => p.append("status", s));
    filters.countryIds.forEach((c) => p.append("countryId", c));
    if (filters.currencyId) p.set("currencyId", filters.currencyId);
    return p.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{ data: TeamMembersData }>({
    queryKey: ["team-members", team.id, apiParams],
    queryFn: () => fetch(`/api/reports/teams/${team.id}/members?${apiParams}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  const memberMap = useMemo(() => {
    const m = new Map<string, string>();
    data?.data.members.forEach((mem) => m.set(mem.id, mem.name));
    return m;
  }, [data]);

  const d = data?.data;

  return (
    <Card className="border-primary border-2 shadow-lg">
      <CardContent className="p-5">
        {/* Panel header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-base">{team.name}</h3>
              <Badge variant="secondary" className="text-xs">{team.memberCount} موظف</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              المدير: {team.manager.name}
              {(filters.dateFrom || filters.dateTo) && (
                <span className="mx-1">
                  · {filters.dateFrom || "—"} → {filters.dateTo || "—"}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={teamOrdersHref}>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />
                جميع الطلبات
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ تحميل البيانات…
            </div>
          </div>
        ) : !d || (d.salesByCurrency.length === 0 && d.statusMatrix.rows.length === 0) ? (
          <div className="text-center py-12 text-muted-foreground">
            <UsersRound className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>لا توجد بيانات للفترة المحددة</p>
          </div>
        ) : (
          <Tabs defaultValue="sales" dir="rtl">
            <TabsList className="mb-4">
              <TabsTrigger value="sales" className="gap-1.5">
                <Trophy className="h-3.5 w-3.5" />
                ترتيب المبيعات
              </TabsTrigger>
              <TabsTrigger value="orders" className="gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />
                الطلبات والحالات
              </TabsTrigger>
            </TabsList>

            {/* ── Panel A: Sales ranking by member, per currency ── */}
            <TabsContent value="sales">
              {d.salesByCurrency.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  لا توجد مبيعات للفترة المحددة
                </div>
              ) : (
                <div className="space-y-6">
                  {d.salesByCurrency.map((curr) => (
                    <div key={curr.currencyCode}>
                      <div className="flex items-center gap-2 mb-3">
                        <Badge className="font-mono">{curr.currencyCode}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {curr.members.length} موظف · {curr.members.reduce((s, m) => s + m.orderCount, 0)} طلب
                        </span>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12 text-center">الترتيب</TableHead>
                            <TableHead>الموظف</TableHead>
                            <TableHead className="text-left font-mono">
                              المبيعات ({curr.currencyCode})
                            </TableHead>
                            <TableHead className="text-center">الطلبات</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {curr.members.map((m) => (
                            <TableRow key={m.userId}>
                              <TableCell className="text-center">
                                <RankBadge rank={m.rank} />
                              </TableCell>
                              <TableCell className="font-medium">
                                {memberMap.get(m.userId) ?? "—"}
                              </TableCell>
                              <TableCell className="font-mono font-semibold text-left">
                                {m.total.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="secondary">{m.orderCount}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Panel B: Orders & statuses by member ── */}
            <TabsContent value="orders">
              {d.statusMatrix.rows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  لا توجد طلبات للفترة المحددة
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[130px]">الموظف</TableHead>
                        {d.statusMatrix.statuses.map((s) => (
                          <TableHead key={s.id} className="text-center whitespace-nowrap">
                            <span
                              className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium"
                              style={{
                                backgroundColor: s.color + "22",
                                color: s.color,
                              }}
                            >
                              {s.name}
                            </span>
                          </TableHead>
                        ))}
                        <TableHead className="text-center font-bold">الإجمالي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.statusMatrix.rows.map((row) => (
                        <TableRow key={row.userId}>
                          <TableCell className="font-medium">
                            {memberMap.get(row.userId) ?? "—"}
                          </TableCell>
                          {d.statusMatrix.statuses.map((s) => (
                            <TableCell key={s.id} className="text-center tabular-nums">
                              {row.counts[s.id] ?? 0}
                            </TableCell>
                          ))}
                          <TableCell className="text-center font-bold tabular-nums">
                            {row.total}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsReportPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role as Role | undefined;

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const allowed = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER";

  const { data: countries = [] } = useQuery<Country[]>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()).then((r) => r.data),
    enabled: allowed,
  });
  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () => fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => r.data),
    enabled: allowed,
  });
  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: allowed,
  });
  const allStatuses = statusesData?.data ?? [];

  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo)   p.set("dateTo", filters.dateTo);
    filters.statuses.forEach((s) => p.append("status", s));
    filters.countryIds.forEach((c) => p.append("countryId", c));
    if (filters.currencyId) p.set("currencyId", filters.currencyId);
    return p.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{ data: TeamStat[] }>({
    queryKey: ["reports-teams", apiParams],
    queryFn: () => fetch(`/api/reports/teams?${apiParams}`).then((r) => r.json()),
    enabled: allowed,
    placeholderData: (prev) => prev,
  });

  const handleFiltersChange = useCallback((f: Filters) => {
    setFilters(f);
    // Collapse panel when filters change so user sees updated data on re-expand
  }, []);

  const handleTeamClick = useCallback((team: TeamStat) => {
    setExpandedTeamId((prev) => (prev === team.id ? null : team.id));
  }, []);

  if (!allowed) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
        <Button variant="link" onClick={() => router.push("/dashboard")}>الرجوع</Button>
      </div>
    );
  }

  const teams = data?.data ?? [];
  const expandedTeam = teams.find((t) => t.id === expandedTeamId) ?? null;

  const teamOrdersHref = expandedTeam
    ? (() => {
        const qs = new URLSearchParams();
        if (filters.dateFrom) qs.set("dateFrom", filters.dateFrom);
        if (filters.dateTo)   qs.set("dateTo",   filters.dateTo);
        return `/reports/teams/${expandedTeam.id}/orders?${qs.toString()}`;
      })()
    : "#";

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UsersRound className="h-6 w-6" />
          تقارير الأداء
        </h1>
        {!isLoading && (
          <Badge variant="secondary">{teams.length} فريق</Badge>
        )}
      </div>

      <ReportsTabs active="teams" />

      {/* Summary row */}
      {!isLoading && teams.length > 0 && (() => {
        const totalOrders    = teams.reduce((s, t) => s + t.totalOrders, 0);
        const totalDelivered = teams.reduce((s, t) => s + t.delivered, 0);
        const overallRate    = totalOrders > 0 ? Math.round((totalDelivered / totalOrders) * 100) : 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "إجمالي الطلبات",  value: totalOrders,    icon: <ShoppingCart className="h-5 w-5 text-indigo-600" />, bg: "bg-indigo-50" },
              { label: "تم التوصيل",       value: totalDelivered, icon: <CheckCircle  className="h-5 w-5 text-green-600"  />, bg: "bg-green-50"  },
              { label: "معدل التوصيل",     value: `${overallRate}%`, icon: <TrendingUp className="h-5 w-5 text-purple-600" />, bg: "bg-purple-50" },
              { label: "عدد الفرق",        value: teams.length,   icon: <UsersRound   className="h-5 w-5 text-blue-600"   />, bg: "bg-blue-50"   },
            ].map((s) => (
              <Card key={s.label} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", s.bg)}>
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        );
      })()}

      <FiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        countries={countries}
        currencies={currencies}
        statuses={allStatuses}
      />

      {/* Team cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
        </div>
      ) : teams.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">لا توجد فرق أو لا توجد بيانات للفترة المحددة</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => {
            const isExpanded = expandedTeamId === team.id;
            return (
              <div
                key={team.id}
                className={cn(
                  "rounded-xl transition-all duration-200",
                  isExpanded && "ring-2 ring-primary ring-offset-2"
                )}
              >
                {/* Expansion toggle hint */}
                <div className="relative">
                  <PerformanceCard
                    variant="team"
                    name={team.name}
                    managerName={team.manager.name}
                    memberCount={team.memberCount}
                    totalOrders={team.totalOrders}
                    delivered={team.delivered}
                    shipped={team.shipped}
                    returned={team.returned}
                    cancelled={team.cancelled}
                    deliveryRate={team.deliveryRate}
                    revenueByCurrency={team.revenueByCurrency}
                    onClick={() => handleTeamClick(team)}
                  />
                  {/* Expand indicator chip */}
                  <div className={cn(
                    "absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-3",
                    "flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[10px] font-medium shadow-sm",
                    isExpanded ? "border-primary text-primary" : "text-muted-foreground",
                  )}>
                    {isExpanded ? (
                      <><ChevronUp className="h-3 w-3" />إغلاق</>
                    ) : (
                      <><ChevronDown className="h-3 w-3" />تفاصيل الأعضاء</>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expansion panel — full width, appears below grid when a team is selected */}
      {expandedTeam && (
        <div className="mt-6 animate-in slide-in-from-top-2 duration-200">
          <TeamExpansionPanel
            team={expandedTeam}
            filters={filters}
            onClose={() => setExpandedTeamId(null)}
            teamOrdersHref={teamOrdersHref}
          />
        </div>
      )}
    </div>
  );
}
