"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  UsersRound, Users, ShoppingCart, CheckCircle, TrendingUp,
  Filter, X, CalendarIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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

// ─── Filters ─────────────────────────────────────────────────────────────────

type Filters = {
  dateFrom: string; dateTo: string;
  statuses: string[]; countryIds: string[]; currencyId: string;
};
const DEFAULT_FILTERS: Filters = {
  dateFrom: "", dateTo: "", statuses: [], countryIds: [], currencyId: "",
};

// ─── Shared tab bar (links to /reports/teams and /reports/employees) ─────────

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


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsReportPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role as Role | undefined;

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

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

  const handleFiltersChange = useCallback((f: Filters) => setFilters(f), []);

  const handleTeamClick = useCallback((team: TeamStat) => {
    const qs = new URLSearchParams();
    if (filters.dateFrom) qs.set("dateFrom", filters.dateFrom);
    if (filters.dateTo)   qs.set("dateTo",   filters.dateTo);
    router.push(`/reports/teams/${team.id}/orders?${qs.toString()}`);
  }, [filters, router]);

  if (!allowed) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
        <Button variant="link" onClick={() => router.push("/dashboard")}>الرجوع</Button>
      </div>
    );
  }

  const teams = data?.data ?? [];

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
        const totalOrders  = teams.reduce((s, t) => s + t.totalOrders, 0);
        const totalDelivered = teams.reduce((s, t) => s + t.delivered, 0);
        const overallRate  = totalOrders > 0 ? Math.round((totalDelivered / totalOrders) * 100) : 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "إجمالي الطلبات",  value: totalOrders,                        icon: <ShoppingCart className="h-5 w-5 text-indigo-600" />, bg: "bg-indigo-50" },
              { label: "تم التوصيل",       value: totalDelivered,                     icon: <CheckCircle  className="h-5 w-5 text-green-600"  />, bg: "bg-green-50"  },
              { label: "معدل التوصيل",     value: `${overallRate}%`,                  icon: <TrendingUp   className="h-5 w-5 text-purple-600" />, bg: "bg-purple-50" },
              { label: "عدد الفرق",        value: teams.length,                       icon: <UsersRound   className="h-5 w-5 text-blue-600"   />, bg: "bg-blue-50"   },
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
          {teams.map((team) => (
            <PerformanceCard
              key={team.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
