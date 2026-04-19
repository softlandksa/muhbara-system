"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  TrendingUp, Users, CalendarIcon, Clock, Package, CheckCircle,
  RotateCcw, DollarSign, BarChart3,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Team = { id: string; name: string };

type EmployeeStat = {
  id: string;
  name: string;
  role: Role;
  team: { id: string; name: string } | null;
  total: number;
  delivered: number;
  returned: number;
  cancelled: number;
  inProgress: number;
  revenue: number;
  avgOrderValue: number;
  deliveryRate: number;
  lastOrderDate: string | null;
  // API also sends revenueByCurrency — not displayed here but accepted for forward compat
  revenueByCurrency?: { currencyCode: string; total: number }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PerformanceBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className={cn("text-lg font-bold", color)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Employee Card ────────────────────────────────────────────────────────────

function EmployeeCard({ emp }: { emp: EmployeeStat }) {
  const rateColor =
    emp.deliveryRate >= 70 ? "bg-green-500" :
    emp.deliveryRate >= 40 ? "bg-yellow-400" : "bg-red-400";
  const borderColor =
    emp.deliveryRate >= 70 ? "border-green-200" :
    emp.deliveryRate >= 40 ? "border-yellow-200" : "border-red-200";
  const rateTextColor =
    emp.deliveryRate >= 70 ? "text-green-600" :
    emp.deliveryRate >= 40 ? "text-yellow-600" : "text-red-500";
  const avatarColor =
    emp.deliveryRate >= 70 ? "bg-green-500" :
    emp.deliveryRate >= 40 ? "bg-yellow-500" : "bg-red-500";

  const initials = emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2);

  return (
    <Card className={cn("border-2", borderColor)}>
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className={cn("font-bold text-white text-sm", avatarColor)}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{emp.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[emp.role]}</p>
            {emp.team && <p className="text-xs text-muted-foreground">{emp.team.name}</p>}
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{emp.total}</p>
            <p className="text-xs text-muted-foreground">طلب</p>
          </div>
        </div>

        {/* Delivery rate */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">نسبة التوصيل</span>
            <span className={cn("font-medium", rateTextColor)}>{emp.deliveryRate}%</span>
          </div>
          <PerformanceBar value={emp.deliveryRate} color={rateColor} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <StatPill label="توصيل"      value={emp.delivered  ?? 0} color="text-green-600"  />
          <StatPill label="مرتجع"      value={emp.returned   ?? 0} color="text-orange-500" />
          <StatPill label="قيد التنفيذ" value={emp.inProgress ?? 0} color="text-blue-500"  />
          <StatPill label="ملغي"       value={emp.cancelled  ?? 0} color="text-red-500"    />
        </div>

        {/* Revenue + avg */}
        <div className="pt-2 border-t space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />إجمالي المبيعات
            </span>
            <span className="font-semibold">{(emp.revenue ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />متوسط قيمة الطلب
            </span>
            <span className="font-semibold">{(emp.avgOrderValue ?? 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Last order */}
        {emp.lastOrderDate && !isNaN(new Date(emp.lastOrderDate).getTime()) && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>آخر طلب: {formatDistanceToNow(new Date(emp.lastOrderDate), { locale: arSA, addSuffix: true })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ employees }: { employees: EmployeeStat[] }) {
  if (employees.length === 0) return null;

  const totalOrders    = employees.reduce((s, e) => s + (e.total    ?? 0), 0);
  const totalDelivered = employees.reduce((s, e) => s + (e.delivered ?? 0), 0);
  const totalRevenue   = employees.reduce((s, e) => s + (e.revenue   ?? 0), 0);
  const avgDeliveryRate =
    employees.length > 0
      ? Math.round(employees.reduce((s, e) => s + (e.deliveryRate ?? 0), 0) / employees.length)
      : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { label: "إجمالي الطلبات",    value: totalOrders.toLocaleString(),    icon: <Package    className="h-5 w-5 text-blue-500"   />, color: "text-blue-700"   },
        { label: "الطلبات المسلمة",   value: totalDelivered.toLocaleString(), icon: <CheckCircle className="h-5 w-5 text-green-500"  />, color: "text-green-700"  },
        { label: "متوسط نسبة التوصيل", value: `${avgDeliveryRate}%`,          icon: <TrendingUp  className="h-5 w-5 text-purple-500" />, color: "text-purple-700" },
        { label: "إجمالي المبيعات",   value: totalRevenue.toLocaleString(),   icon: <DollarSign  className="h-5 w-5 text-amber-500"  />, color: "text-amber-700"  },
      ].map((s) => (
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
  );
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function ActualPerformanceInner() {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const filterTeamId = searchParams.get("teamId") ?? "";

  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const canViewAll = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "HR";

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["teams-list"],
    queryFn: () => fetch("/api/teams").then((r) => r.json()).then((r) => r.data ?? []),
    enabled: canViewAll,
  });

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: EmployeeStat[] }>({
    queryKey: ["actual-performance", qs],
    queryFn: () => fetch(`/api/reports/employees?${qs}`).then((r) => r.json()),
    enabled: !!role && (role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR"),
    placeholderData: (prev) => prev,
  });

  if (role && role !== "ADMIN" && role !== "GENERAL_MANAGER" && role !== "SALES_MANAGER" && role !== "HR") {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
      </div>
    );
  }

  const employees = data?.data ?? [];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6" />
          تقارير الأداء الفعلي
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          بيانات محسوبة تلقائياً من الطلبات الفعلية في النظام — المصدر الرسمي للأداء
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {canViewAll && (
              <div className="space-y-1.5">
                <Label className="text-xs">الفريق</Label>
                <SearchableSelect
                  options={[{ value: "", label: "كل الفرق" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                  value={filterTeamId}
                  onChange={(v) => updateParam("teamId", v || null)}
                  placeholder="كل الفرق"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">من تاريخ</Label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{dateFrom || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateFrom ? new Date(dateFrom) : undefined}
                    onDayClick={(d) => { updateParam("dateFrom", format(d, "yyyy-MM-dd")); setDateFromOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">إلى تاريخ</Label>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{dateTo || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateTo ? new Date(dateTo) : undefined}
                    onDayClick={(d) => { updateParam("dateTo", format(d, "yyyy-MM-dd")); setDateToOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {!isLoading && <SummaryCards employees={employees} />}

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-60" />)}
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground flex flex-col items-center gap-2">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p>لا توجد بيانات لهذه الفترة</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              الموظفون
            </h2>
            <Badge variant="secondary">{employees.length}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees.map((emp) => (
              <EmployeeCard key={emp.id} emp={emp} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ActualPerformancePage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <ActualPerformanceInner />
    </Suspense>
  );
}
