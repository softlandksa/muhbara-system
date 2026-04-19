"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Users, TrendingUp, Filter, X, CalendarIcon,
  ShoppingCart, CheckCircle,
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

type EmployeeStat = {
  id: string;
  name: string;
  role: Role;
  team: { id: string; name: string } | null;
  total: number;
  delivered: number;
  returned: number;
  cancelled: number;
  shipped: number;
  deliveryRate: number;
  totalRevenue: number;
  revenueByCurrency: { currencyCode: string; total: number }[];
  lastOrderDate: string | null;
};

type StatusItem    = { id: string; name: string; color: string };
type CountryOption = { id: string; name: string };
type CurrencyOption = { id: string; code: string; name: string };

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
    { key: "teams",     label: "أداء الفرق",      href: "/reports/teams"     },
    { key: "employees", label: "تقارير الموظفين",  href: "/reports/employees" },
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
  countries: CountryOption[];
  currencies: CurrencyOption[];
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
            onDayClick={(d) => { onChange({ ...filters, dateFrom: format(d, "yyyy-MM-dd") }); setDfOpen(false); }} />
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
            onDayClick={(d) => { onChange({ ...filters, dateTo: format(d, "yyyy-MM-dd") }); setDtOpen(false); }} />
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

export default function EmployeesReportPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const allowed = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR";

  const { data: countries = [] } = useQuery<CountryOption[]>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: allowed,
  });

  const { data: currencies = [] } = useQuery<CurrencyOption[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () => fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
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
    if (filters.dateFrom)   p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo)     p.set("dateTo", filters.dateTo);
    filters.statuses.forEach((s) => p.append("status", s));
    filters.countryIds.forEach((c) => p.append("countryId", c));
    if (filters.currencyId) p.set("currencyId", filters.currencyId);
    return p.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{ data: EmployeeStat[] }>({
    queryKey: ["reports-employees", apiParams],
    queryFn: () => fetch(`/api/reports/employees?${apiParams}`).then((r) => r.json()),
    enabled: allowed,
    placeholderData: (prev) => prev,
  });

  const handleFiltersChange = useCallback((f: Filters) => setFilters(f), []);

  if (!allowed) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
      </div>
    );
  }

  const employees = data?.data ?? [];

  // Summary stats
  const totalOrders    = employees.reduce((s, e) => s + e.total, 0);
  const totalDelivered = employees.reduce((s, e) => s + e.delivered, 0);
  const overallRate    = totalOrders > 0 ? Math.round((totalDelivered / totalOrders) * 100) : 0;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          تقارير الأداء
        </h1>
        {!isLoading && (
          <Badge variant="secondary">{employees.length} موظف</Badge>
        )}
      </div>

      <ReportsTabs active="employees" />

      {/* Summary row */}
      {!isLoading && employees.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: "إجمالي الطلبات", value: totalOrders,   icon: <ShoppingCart className="h-5 w-5 text-indigo-600" />, bg: "bg-indigo-50" },
            { label: "تم التوصيل",      value: totalDelivered, icon: <CheckCircle  className="h-5 w-5 text-green-600"  />, bg: "bg-green-50"  },
            { label: "معدل التوصيل",    value: `${overallRate}%`, icon: <TrendingUp className="h-5 w-5 text-purple-600" />, bg: "bg-purple-50" },
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
      )}

      <FiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        countries={countries}
        currencies={currencies}
        statuses={allStatuses}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">لا توجد بيانات</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((emp) => (
            <PerformanceCard
              key={emp.id}
              variant="employee"
              name={emp.name}
              role={emp.role}
              teamName={emp.team?.name ?? null}
              lastOrderDate={emp.lastOrderDate}
              totalOrders={emp.total}
              delivered={emp.delivered}
              shipped={emp.shipped}
              returned={emp.returned}
              cancelled={emp.cancelled}
              deliveryRate={emp.deliveryRate}
              revenueByCurrency={emp.revenueByCurrency}
              onClick={() => router.push(`/orders?createdById=${emp.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
