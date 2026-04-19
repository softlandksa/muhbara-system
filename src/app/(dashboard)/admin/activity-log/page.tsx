"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Activity, CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

type ActivityLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; role: Role };
};

type LookupUser = { id: string; name: string; role: Role };

const ACTION_LABELS: Record<string, string> = {
  CREATE_ORDER: "إنشاء طلب",
  UPDATE_ORDER: "تعديل طلب",
  DELETE_ORDER: "حذف طلب",
  STATUS_CHANGE: "تغيير الحالة",
  NOTE_ADDED: "إضافة ملاحظة",
  SHIP_ORDER: "شحن طلب",
  UPDATE_SHIPPING: "تحديث الشحن",
  CALCULATE_COMMISSIONS: "حساب العمولات",
  UPDATE_COMMISSION: "تحديث عمولة",
  IMPORT_ORDERS: "استيراد طلبات",
  LOGIN: "تسجيل دخول",
  LOGOUT: "تسجيل خروج",
};

const ACTION_COLORS: Record<string, string> = {
  CREATE_ORDER: "bg-green-100 text-green-700",
  UPDATE_ORDER: "bg-blue-100 text-blue-700",
  DELETE_ORDER: "bg-red-100 text-red-700",
  STATUS_CHANGE: "bg-purple-100 text-purple-700",
  NOTE_ADDED: "bg-yellow-100 text-yellow-700",
  SHIP_ORDER: "bg-orange-100 text-orange-700",
  UPDATE_SHIPPING: "bg-orange-100 text-orange-700",
  CALCULATE_COMMISSIONS: "bg-teal-100 text-teal-700",
  UPDATE_COMMISSION: "bg-teal-100 text-teal-700",
  IMPORT_ORDERS: "bg-indigo-100 text-indigo-700",
  LOGIN: "bg-gray-100 text-gray-600",
  LOGOUT: "bg-gray-100 text-gray-600",
};

const ENTITY_LABELS: Record<string, string> = {
  Order: "طلب",
  ShippingInfo: "شحنة",
  Commission: "عمولة",
  User: "مستخدم",
  Team: "فريق",
};

function ActivityLogInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const userId = searchParams.get("userId") ?? "";
  const action = searchParams.get("action") ?? "";
  const entityType = searchParams.get("entityType") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    if (key !== "page") params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: users = [] } = useQuery<LookupUser[]>({
    queryKey: ["lookup-users-activity"],
    queryFn: () => fetch("/api/lookup/users").then(r => r.json()).then(r => r.data ?? []),
    enabled: session?.user?.role === "ADMIN",
  });

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{
    data: ActivityLog[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>({
    queryKey: ["activity-log", qs],
    queryFn: () => fetch(`/api/activity-log?${qs}`).then(r => r.json()),
    placeholderData: prev => prev,
    enabled: session?.user?.role === "ADMIN",
  });

  if (session?.user?.role !== "ADMIN") {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح بالوصول</p>
      </div>
    );
  }

  const logs = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Activity className="h-6 w-6" />سجل النشاط
      </h1>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">الموظف</Label>
              <SearchableSelect
                options={[{ value: "", label: "الكل" }, ...users.map(u => ({
                  value: u.id, label: u.name, sublabel: ROLE_LABELS[u.role],
                }))]}
                value={userId} onChange={v => setParam("userId", v || null)} placeholder="كل الموظفين"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">الإجراء</Label>
              <SearchableSelect
                options={[
                  { value: "", label: "الكل" },
                  ...Object.entries(ACTION_LABELS).map(([v, l]) => ({ value: v, label: l })),
                ]}
                value={action} onChange={v => setParam("action", v || null)} placeholder="كل الإجراءات"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">النوع</Label>
              <SearchableSelect
                options={[
                  { value: "", label: "الكل" },
                  ...Object.entries(ENTITY_LABELS).map(([v, l]) => ({ value: v, label: l })),
                ]}
                value={entityType} onChange={v => setParam("entityType", v || null)} placeholder="كل الأنواع"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">من تاريخ</Label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{dateFrom || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dateFrom ? new Date(dateFrom) : undefined}
                    onDayClick={d => { setParam("dateFrom", format(d, "yyyy-MM-dd")); setDateFromOpen(false); }} />
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
                    onDayClick={d => { setParam("dateTo", format(d, "yyyy-MM-dd")); setDateToOpen(false); }} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {(userId || action || entityType || dateFrom || dateTo) && (
            <button
              className="mt-3 text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => router.replace(pathname)}
            >
              مسح الفلاتر
            </button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ والوقت</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>الإجراء</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>التفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                      <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      لا توجد سجلات
                    </TableCell>
                  </TableRow>
                ) : logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm font-mono whitespace-nowrap">
                      {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm:ss", { locale: arSA })}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{log.user.name}</div>
                      <div className="text-xs text-muted-foreground">{ROLE_LABELS[log.user.role]}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={cn("text-xs", ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-600")}
                      >
                        {ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ENTITY_LABELS[log.entityType] ?? log.entityType}
                      {log.entityId && (
                        <span className="text-xs text-muted-foreground block font-mono">
                          {log.entityId.slice(0, 8)}...
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs">
                      {log.details ? (
                        <pre className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
                          {JSON.stringify(log.details)}
                        </pre>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {pagination.total} سجل · صفحة {pagination.page} من {pagination.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setParam("page", String(pagination.page - 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setParam("page", String(pagination.page + 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ActivityLogPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <ActivityLogInner />
    </Suspense>
  );
}
