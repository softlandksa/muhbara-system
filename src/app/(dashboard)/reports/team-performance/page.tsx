"use client";

import { useState, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  ArrowRight, Users, Clock, TrendingUp, ShoppingCart, CheckCircle,
  Truck, RotateCcw, XCircle, Filter, X, CalendarIcon, Download,
  Loader2, Search, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/permissions";
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
  shipped: number;
  returned: number;
  cancelled: number;
  readyToShip: number;
  revenue: number;
  deliveryRate: number;
  lastOrderDate: string | null;
};

type TeamSummary = {
  total: number;
  delivered: number;
  shipped: number;
  returned: number;
  cancelled: number;
  readyToShip: number;
  totalRevenue: number;
};

type TeamPerformanceData = {
  summary: TeamSummary;
  employees: EmployeeStat[];
};

type StatusItem = { id: string; name: string; color: string };

type OrderRow = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  status: StatusItem;
  totalAmount: number;
  country: { name: string };
  currency: { code: string };
  items: { quantity: number; product: { name: string } }[];
};

type Country = { id: string; name: string };
type Currency = { id: string; code: string; name: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─── Filters type ─────────────────────────────────────────────────────────────

type Filters = {
  dateFrom: string;
  dateTo: string;
  statuses: string[];
  countryIds: string[];
  currencyId: string;
};

const defaultFilters: Filters = {
  dateFrom: "", dateTo: "", statuses: [], countryIds: [], currencyId: "",
};

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon, color, subValue,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  subValue?: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
            {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
          </div>
          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", color)}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Employee Performance Card ────────────────────────────────────────────────

function EmployeeCard({
  emp,
  onClick,
}: {
  emp: EmployeeStat;
  onClick: () => void;
}) {
  const borderColor =
    emp.deliveryRate >= 80 ? "border-green-400" :
    emp.deliveryRate >= 50 ? "border-yellow-400" :
    "border-red-400";

  const rateColor =
    emp.deliveryRate >= 80 ? "text-green-600" :
    emp.deliveryRate >= 50 ? "text-yellow-600" :
    "text-red-500";

  const barColor =
    emp.deliveryRate >= 80 ? "bg-green-500" :
    emp.deliveryRate >= 50 ? "bg-yellow-400" :
    "bg-red-400";

  const avatarColor =
    emp.deliveryRate >= 80 ? "bg-green-500" :
    emp.deliveryRate >= 50 ? "bg-yellow-500" :
    "bg-red-500";

  const initials = emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Card
      className={cn(
        "cursor-pointer border-2 transition-all duration-200",
        "hover:shadow-lg hover:scale-[1.02]",
        borderColor
      )}
      onClick={onClick}
    >
      <CardContent className="p-5 space-y-4">
        {/* Header: avatar + name + total */}
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11 shrink-0">
            <AvatarFallback className={cn("font-bold text-white text-sm", avatarColor)}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate text-sm">{emp.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[emp.role]}</p>
            {emp.team && <p className="text-xs text-muted-foreground">{emp.team.name}</p>}
          </div>
          <div className="text-center shrink-0">
            <p className="text-3xl font-bold leading-none">{emp.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">طلب</p>
          </div>
        </div>

        {/* Delivery rate bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">معدل التوصيل</span>
            <span className={cn("font-semibold", rateColor)}>{emp.deliveryRate}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", barColor)}
              style={{ width: `${Math.min(emp.deliveryRate, 100)}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            { label: "توصيل", value: emp.delivered, color: "text-green-600" },
            { label: "شحن",   value: emp.shipped,   color: "text-yellow-600" },
            { label: "مرتجع", value: emp.returned,  color: "text-orange-500" },
            { label: "ملغي",  value: emp.cancelled, color: "text-red-500" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-muted/40 py-1.5">
              <p className={cn("text-base font-bold leading-none", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Revenue + last order */}
        <div className="pt-2 border-t space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              إجمالي المبيعات
            </span>
            <span className="font-semibold">{emp.revenue.toLocaleString()}</span>
          </div>
          {emp.lastOrderDate && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                آخر طلب: {formatDistanceToNow(new Date(emp.lastOrderDate), { locale: arSA, addSuffix: true })}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Filters Bar ──────────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  onChange,
  countries,
  currencies,
  statuses,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  countries: Country[];
  currencies: Currency[];
  statuses: StatusItem[];
}) {
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);

  const hasFilters = filters.dateFrom || filters.dateTo || filters.statuses.length > 0
    || filters.countryIds.length > 0 || filters.currencyId;

  const toggleStatus = (s: string) => {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s];
    onChange({ ...filters, statuses: next });
  };

  const toggleCountry = (id: string) => {
    const next = filters.countryIds.includes(id)
      ? filters.countryIds.filter((x) => x !== id)
      : [...filters.countryIds, id];
    onChange({ ...filters, countryIds: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-4 rounded-xl border bg-muted/20">
      {/* Date From */}
      <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm hover:bg-muted">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {filters.dateFrom || "من تاريخ"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
            onDayClick={(d) => { onChange({ ...filters, dateFrom: format(d, "yyyy-MM-dd") }); setDateFromOpen(false); }}
          />
        </PopoverContent>
      </Popover>

      {/* Date To */}
      <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
        <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm hover:bg-muted">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {filters.dateTo || "إلى تاريخ"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={filters.dateTo ? new Date(filters.dateTo) : undefined}
            onDayClick={(d) => { onChange({ ...filters, dateTo: format(d, "yyyy-MM-dd") }); setDateToOpen(false); }}
          />
        </PopoverContent>
      </Popover>

      {/* Status multi-select */}
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted",
          filters.statuses.length > 0
            ? "border-primary bg-primary/5 text-primary"
            : "border-input bg-background"
        )}>
          <Filter className="h-3.5 w-3.5" />
          الحالة
          {filters.statuses.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">{filters.statuses.length}</Badge>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-52 p-3 space-y-1.5" align="start">
          {statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <Checkbox
                id={`f-status-${s.id}`}
                checked={filters.statuses.includes(s.id)}
                onCheckedChange={() => toggleStatus(s.id)}
              />
              <label htmlFor={`f-status-${s.id}`} className="text-xs cursor-pointer">{s.name}</label>
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {/* Country multi-select */}
      {countries.length > 0 && (
        <Popover open={countryOpen} onOpenChange={setCountryOpen}>
          <PopoverTrigger className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted",
            filters.countryIds.length > 0
              ? "border-primary bg-primary/5 text-primary"
              : "border-input bg-background"
          )}>
            <Filter className="h-3.5 w-3.5" />
            الدولة
            {filters.countryIds.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">{filters.countryIds.length}</Badge>
            )}
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 space-y-1.5 max-h-64 overflow-y-auto" align="start">
            {countries.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox
                  id={`f-country-${c.id}`}
                  checked={filters.countryIds.includes(c.id)}
                  onCheckedChange={() => toggleCountry(c.id)}
                />
                <label htmlFor={`f-country-${c.id}`} className="text-xs cursor-pointer">{c.name}</label>
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
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
          ))}
        </select>
      )}

      {/* Reset */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-muted-foreground"
          onClick={() => onChange(defaultFilters)}
        >
          <X className="h-3.5 w-3.5" />
          مسح
        </Button>
      )}
    </div>
  );
}

// ─── Employee Detail (Orders Table) ──────────────────────────────────────────

function EmployeeDetail({
  employee,
  filters,
  onBack,
}: {
  employee: EmployeeStat;
  filters: Filters;
  onBack: () => void;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [exportLoading, setExportLoading] = useState(false);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("createdById", employee.id);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    if (search) p.set("search", search);
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) p.set("dateTo", filters.dateTo);
    filters.statuses.forEach((s) => p.append("status", s));
    filters.countryIds.forEach((c) => p.append("countryId", c));
    if (filters.currencyId) p.set("currencyId", filters.currencyId);
    return p.toString();
  }, [employee.id, page, search, filters]);

  const { data, isLoading } = useQuery<{
    data: OrderRow[];
    total: number;
    totalPages: number;
  }>({
    queryKey: ["team-perf-orders", employee.id, queryParams],
    queryFn: () => fetch(`/api/orders?${queryParams}`).then((r) => r.json()),
  });

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const p = new URLSearchParams(queryParams);
      p.delete("page");
      p.delete("pageSize");
      const res = await fetch(`/api/orders/export?${p.toString()}`);
      if (!res.ok) { toast.error("فشل التصدير"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `طلبات_${employee.name}_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportLoading(false);
    }
  };

  const orders = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Avatar className="h-9 w-9">
          <AvatarFallback
            className={cn(
              "font-bold text-white text-sm",
              employee.deliveryRate >= 80 ? "bg-green-500" :
              employee.deliveryRate >= 50 ? "bg-yellow-500" : "bg-red-500"
            )}
          >
            {employee.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-lg font-bold">{employee.name}</h2>
          <p className="text-xs text-muted-foreground">{ROLE_LABELS[employee.role]}</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exportLoading}>
            {exportLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />
            }
            <span className="mr-1 hidden sm:inline">تصدير</span>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pr-9"
          placeholder="بحث برقم الطلب أو اسم العميل..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الطلب</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الدولة</TableHead>
              <TableHead>المنتجات</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>العملة</TableHead>
              <TableHead>الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  لا توجد طلبات
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-sm">{order.orderNumber}</TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(order.orderDate), "dd/MM/yyyy", { locale: arSA })}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{order.customerName}</div>
                  </TableCell>
                  <TableCell className="text-sm">{order.country.name}</TableCell>
                  <TableCell className="max-w-[160px]">
                    <div className="truncate text-sm">
                      {order.items.map((i) => `${i.product.name} (${i.quantity})`).join("، ")}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium text-sm">{order.totalAmount.toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{order.currency.code}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
                      {order.status.name}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{data?.total ?? 0} طلب — صفحة {page} من {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span>{page}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamPerformancePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user?.role;

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeStat | null>(null);

  // Lookup data for filters
  const { data: countries = [] } = useQuery<Country[]>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()).then((r) => r.data),
    enabled: role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR",
  });

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () => fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => r.data),
    enabled: role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR",
  });

  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const allStatuses = statusesData?.data ?? [];

  // Team performance data
  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) p.set("dateTo", filters.dateTo);
    filters.statuses.forEach((s) => p.append("status", s));
    filters.countryIds.forEach((c) => p.append("countryId", c));
    if (filters.currencyId) p.set("currencyId", filters.currencyId);
    return p.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<TeamPerformanceData>({
    queryKey: ["team-performance", apiParams],
    queryFn: () =>
      fetch(`/api/reports/team-performance?${apiParams}`)
        .then((r) => r.json()),
    enabled: role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR",
  });

  const handleFiltersChange = useCallback((f: Filters) => {
    setFilters(f);
    setSelectedEmployee(null); // reset detail view on filter change
  }, []);

  if (role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER" && role !== "HR") {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
        <Button variant="link" onClick={() => router.push("/dashboard")}>الرجوع</Button>
      </div>
    );
  }

  const summary = data?.summary;
  const employees = data?.employees ?? [];

  const summaryCards = [
    {
      label: "إجمالي الطلبات",
      value: summary?.total ?? 0,
      icon: <ShoppingCart className="h-6 w-6 text-white" />,
      color: "bg-indigo-500",
    },
    {
      label: "تم التوصيل",
      value: summary?.delivered ?? 0,
      icon: <CheckCircle className="h-6 w-6 text-white" />,
      color: "bg-green-500",
      subValue: summary?.total
        ? `${Math.round(((summary.delivered) / summary.total) * 100)}% من الإجمالي`
        : undefined,
    },
    {
      label: "قيد الشحن",
      value: summary?.shipped ?? 0,
      icon: <Truck className="h-6 w-6 text-white" />,
      color: "bg-yellow-500",
    },
    {
      label: "مرتجع",
      value: summary?.returned ?? 0,
      icon: <RotateCcw className="h-6 w-6 text-white" />,
      color: "bg-orange-500",
    },
    {
      label: "ملغي",
      value: summary?.cancelled ?? 0,
      icon: <XCircle className="h-6 w-6 text-white" />,
      color: "bg-red-500",
    },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          أداء الفريق
        </h1>
        {!isLoading && (
          <Badge variant="secondary">{employees.length} موظف</Badge>
        )}
      </div>

      {/* Summary cards (always visible) */}
      {!selectedEmployee && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)
            : summaryCards.map((c) => <SummaryCard key={c.label} {...c} />)
          }
        </div>
      )}

      {/* Filters bar */}
      <FiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        countries={countries}
        currencies={currencies}
        statuses={allStatuses}
      />

      {/* Content: detail view OR grid */}
      {selectedEmployee ? (
        <EmployeeDetail
          employee={selectedEmployee}
          filters={filters}
          onBack={() => setSelectedEmployee(null)}
        />
      ) : (
        <>
          {/* Total revenue line */}
          {summary && summary.totalRevenue > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              إجمالي إيرادات الفريق:
              <span className="font-semibold text-foreground">
                {summary.totalRevenue.toLocaleString()}
              </span>
            </div>
          )}

          {/* Employee cards grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
            </div>
          ) : employees.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              لا توجد بيانات للفترة المحددة
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.map((emp) => (
                <EmployeeCard
                  key={emp.id}
                  emp={emp}
                  onClick={() => setSelectedEmployee(emp)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
