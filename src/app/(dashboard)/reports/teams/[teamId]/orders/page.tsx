"use client";

import { useState, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowRight, Download, Search, Filter, X, CalendarIcon,
  ShoppingCart, CheckCircle, Truck, RotateCcw, XCircle, ChevronLeft, ChevronRight,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusOption  = { id: string; name: string; color: string };
type CountryOption = { id: string; name: string };
type CurrencyOption = { id: string; code: string; name: string };
type UserOption    = { id: string; name: string; role: Role };

type OrderRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  orderDate: string;
  totalAmount: number;
  status:       { id: string; name: string; color: string } | null;
  country:      { name: string } | null;
  currency:     { code: string } | null;
  createdBy:    { id: string; name: string } | null;
  items:        { product: { name: string } | null; quantity: number }[];
  _count:       { items: number };
};

type TeamInfo = { id: string; name: string; manager: { name: string } | null };

// ─── Filters ─────────────────────────────────────────────────────────────────

type Filters = {
  search: string;
  dateFrom: string; dateTo: string;
  statuses: string[]; countryIds: string[];
  currencyId: string; createdById: string;
  page: number;
};

const PAGE_SIZE = 25;

// ─── Inner page (uses useSearchParams) ───────────────────────────────────────

function TeamOrdersInner() {
  const { teamId } = useParams<{ teamId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;

  const allowed = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER";

  // Initialise filters from URL (dateFrom/dateTo passed from team card click)
  const [filters, setFilters] = useState<Filters>({
    search:     "",
    dateFrom:   searchParams.get("dateFrom") ?? "",
    dateTo:     searchParams.get("dateTo") ?? "",
    statuses:   [],
    countryIds: [],
    currencyId: "",
    createdById: "",
    page: 1,
  });

  const [dfOpen, setDfOpen] = useState(false);
  const [dtOpen, setDtOpen] = useState(false);
  const [stOpen, setStOpen] = useState(false);
  const [coOpen, setCoOpen] = useState(false);

  // ── Lookups ──────────────────────────────────────────────────────────────

  const { data: statusesData } = useQuery<{ data: StatusOption[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: allowed,
  });
  const allStatuses = statusesData?.data ?? [];

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

  const { data: teamMembers = [] } = useQuery<UserOption[]>({
    queryKey: ["team-members", teamId],
    queryFn: () =>
      fetch(`/api/lookup/users?teamId=${teamId}&role=SALES&role=SUPPORT&role=SALES_MANAGER`)
        .then((r) => r.json())
        .then((r) => r.data),
    enabled: allowed && !!teamId,
  });

  // ── Team info (fetch via reports/teams to get name) ───────────────────────

  const { data: teamInfoData } = useQuery<{ data: TeamInfo[] }>({
    queryKey: ["reports-teams-info"],
    queryFn: () => fetch("/api/reports/teams").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
    enabled: allowed,
  });
  const teamInfo = teamInfoData?.data?.find((t) => t.id === teamId);

  // ── Orders query ──────────────────────────────────────────────────────────

  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("teamId", teamId);
    p.set("page", String(filters.page));
    p.set("pageSize", String(PAGE_SIZE));
    if (filters.search)     p.set("search", filters.search);
    if (filters.dateFrom)   p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo)     p.set("dateTo", filters.dateTo);
    filters.statuses.forEach((s) => p.append("status", s));
    filters.countryIds.forEach((c) => p.append("countryId", c));
    if (filters.currencyId)  p.set("currencyId", filters.currencyId);
    if (filters.createdById) p.set("createdById", filters.createdById);
    return p.toString();
  }, [filters, teamId]);

  const { data: ordersData, isLoading } = useQuery<{
    data: OrderRow[]; total: number; page: number; pageSize: number; totalPages: number;
  }>({
    queryKey: ["team-orders", apiParams],
    queryFn: () => fetch(`/api/orders?${apiParams}`).then((r) => r.json()),
    enabled: allowed && !!teamId,
    placeholderData: (prev) => prev,
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const orders     = ordersData?.data ?? [];
  const total      = ordersData?.total ?? 0;
  const totalPages = ordersData?.totalPages ?? 1;

  const hasFilters =
    filters.search || filters.dateFrom || filters.dateTo ||
    filters.statuses.length > 0 || filters.countryIds.length > 0 ||
    filters.currencyId || filters.createdById;

  const clearFilters = useCallback(() =>
    setFilters((f) => ({ ...f, search: "", statuses: [], countryIds: [], currencyId: "", createdById: "", page: 1 })),
  []);

  const handleExport = useCallback(() => {
    const p = new URLSearchParams(apiParams);
    p.delete("page");
    p.delete("pageSize");
    window.open(`/api/orders/export?${p.toString()}`, "_blank");
  }, [apiParams]);

  if (!allowed) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
        <Button variant="link" onClick={() => router.push("/reports/teams")}>الرجوع</Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/reports/teams"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowRight className="h-4 w-4" />
            الرجوع
          </Link>
          <div>
            <h1 className="text-xl font-bold">
              طلبات فريق: {teamInfo?.name ?? "..."}
            </h1>
            {teamInfo?.manager && (
              <p className="text-xs text-muted-foreground">المدير: {teamInfo.manager.name}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isLoading && (
            <Badge variant="secondary">{total.toLocaleString()} طلب</Badge>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExport}>
            <Download className="h-4 w-4" />
            تصدير Excel
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-4 rounded-xl border bg-muted/20">

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="بحث..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
            className="h-8 w-44 pr-8 text-sm"
          />
        </div>

        {/* Date From */}
        <Popover open={dfOpen} onOpenChange={setDfOpen}>
          <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm hover:bg-muted">
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
            {filters.dateFrom || "من تاريخ"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar mode="single" selected={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
              onDayClick={(d) => { setFilters((f) => ({ ...f, dateFrom: format(d, "yyyy-MM-dd"), page: 1 })); setDfOpen(false); }} />
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
              onDayClick={(d) => { setFilters((f) => ({ ...f, dateTo: format(d, "yyyy-MM-dd"), page: 1 })); setDtOpen(false); }} />
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
            {allStatuses.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox id={`fs-${s.id}`} checked={filters.statuses.includes(s.id)}
                  onCheckedChange={() => {
                    const next = filters.statuses.includes(s.id)
                      ? filters.statuses.filter((x) => x !== s.id)
                      : [...filters.statuses, s.id];
                    setFilters((f) => ({ ...f, statuses: next, page: 1 }));
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
                      setFilters((f) => ({ ...f, countryIds: next, page: 1 }));
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
            onChange={(e) => setFilters((f) => ({ ...f, currencyId: e.target.value, page: 1 }))}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">كل العملات</option>
            {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        )}

        {/* Member */}
        {teamMembers.length > 0 && (
          <select
            value={filters.createdById}
            onChange={(e) => setFilters((f) => ({ ...f, createdById: e.target.value, page: 1 }))}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">كل الموظفين</option>
            {teamMembers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />مسح
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">لا توجد طلبات للفترة المحددة</div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">رقم الطلب</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">العميل</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">الدولة</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">المنتجات</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">المبلغ</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">الحالة</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">الموظف</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b hover:bg-muted/20 cursor-pointer transition-colors"
                    onClick={() => router.push(`/orders/${order.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-primary">{order.orderNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{order.customerName}</p>
                      <p className="text-xs text-muted-foreground">{order.phone}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{order.country?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {order.items.slice(0, 2).map((item, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            {item.product?.name ?? "?"} × {item.quantity}
                          </p>
                        ))}
                        {order._count.items > 2 && (
                          <p className="text-xs text-muted-foreground">+{order._count.items - 2} منتج</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {order.totalAmount.toLocaleString()}
                      <span className="text-xs text-muted-foreground mr-1">{order.currency?.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      {order.status ? (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: order.status.color, color: order.status.color }}
                        >
                          {order.status.name}
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{order.createdBy?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {format(new Date(order.orderDate), "dd/MM/yyyy")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                {((filters.page - 1) * PAGE_SIZE) + 1}–{Math.min(filters.page * PAGE_SIZE, total)} من {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="icon" className="h-8 w-8"
                  disabled={filters.page <= 1}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="text-sm px-2">صفحة {filters.page} / {totalPages}</span>
                <Button
                  variant="outline" size="icon" className="h-8 w-8"
                  disabled={filters.page >= totalPages}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Page (wraps inner in Suspense for useSearchParams) ──────────────────────

export default function TeamOrdersPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-4" dir="rtl">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    }>
      <TeamOrdersInner />
    </Suspense>
  );
}
