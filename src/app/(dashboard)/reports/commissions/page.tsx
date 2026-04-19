"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { CalendarIcon, Target, TrendingUp, DollarSign, Users } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role, CommissionStatus } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Commission = {
  id: string;
  periodStart: string; periodEnd: string;
  totalDeliveredOrders: number;
  commissionAmount: number;
  status: CommissionStatus;
  calculatedAt: string;
  user: { id: string; name: string; role: Role };
  rule: { id: string; name: string; commissionType: string };
  currency: { id: string; code: string; symbol: string };
  approvedBy: { id: string; name: string } | null;
};

type TargetEntry = {
  id: string;
  name: string;
  role: Role;
  team: { id: string; name: string } | null;
  totalOrders: number;
  deliveredOrders: number;
  targetOrders: number | null;
  targetAchievement: number | null;
  commissionAmount: number;
  commissionCurrency: { code: string; symbol: string } | null;
  ruleName: string | null;
};

type LookupUser = { id: string; name: string; role: Role };

const STATUS_LABELS: Record<CommissionStatus, string> = {
  PENDING: "معلق", APPROVED: "موافق عليه", PAID: "مدفوع",
};
const STATUS_COLORS: Record<CommissionStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-blue-100 text-blue-800 border-blue-200",
  PAID: "bg-green-100 text-green-800 border-green-200",
};
const NEXT_STATUS: Record<CommissionStatus, CommissionStatus | null> = {
  PENDING: "APPROVED", APPROVED: "PAID", PAID: null,
};
const NEXT_LABEL: Record<CommissionStatus, string> = {
  PENDING: "الموافقة", APPROVED: "تعيين كمدفوع", PAID: "",
};

// ─── Target Achievement Card ──────────────────────────────────────────────────

function TargetCard({ entry }: { entry: TargetEntry }) {
  const pct = entry.targetAchievement;
  const color =
    pct === null ? "bg-gray-400" :
    pct >= 80 ? "bg-green-500" :
    pct >= 50 ? "bg-yellow-400" : "bg-red-400";
  const textColor =
    pct === null ? "text-gray-500" :
    pct >= 80 ? "text-green-700" :
    pct >= 50 ? "text-yellow-700" : "text-red-600";
  const borderColor =
    pct === null ? "border-gray-200" :
    pct >= 80 ? "border-green-200" :
    pct >= 50 ? "border-yellow-200" : "border-red-200";

  return (
    <Card className={cn("border-2", borderColor)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold truncate">{entry.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[entry.role]}</p>
            {entry.team && <p className="text-xs text-muted-foreground">{entry.team.name}</p>}
          </div>
          {pct !== null && (
            <span className={cn("text-2xl font-bold shrink-0", textColor)}>{pct}%</span>
          )}
        </div>

        {/* Progress bar */}
        {entry.targetOrders !== null && (
          <div className="space-y-1">
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", color)}
                style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>الفعلي: {entry.deliveredOrders} طلب</span>
              <span>التارجت: {entry.targetOrders} طلب</span>
            </div>
          </div>
        )}

        {entry.targetOrders === null && (
          <p className="text-xs text-muted-foreground">لم يُحدد تارجت شهري لهذا الموظف</p>
        )}

        {/* Commission */}
        <div className="pt-2 border-t flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3.5 w-3.5" />العمولة المستحقة
          </span>
          <span className="font-bold">
            {entry.commissionAmount > 0
              ? `${entry.commissionAmount.toLocaleString()} ${entry.commissionCurrency?.code ?? ""}`
              : "—"}
          </span>
        </div>
        {entry.ruleName && (
          <p className="text-xs text-muted-foreground">القاعدة: {entry.ruleName}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main inner component ─────────────────────────────────────────────────────

function CommissionsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const role = session?.user?.role as Role | undefined;
  const isAdmin = role === "ADMIN";
  const isHR = role === "HR";
  const isGeneralManager = role === "GENERAL_MANAGER";
  const canFilterUsers = isAdmin || isGeneralManager || isHR;
  const isReadonly = isHR; // HR can only view, not approve/pay

  const [activeTab, setActiveTab] = useState<"commissions" | "targets">("targets");

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const filterUserId = searchParams.get("userId") ?? "";
  const filterStatus = searchParams.get("status") ?? "";
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
  const [targetDateFromOpen, setTargetDateFromOpen] = useState(false);
  const [targetDateToOpen, setTargetDateToOpen] = useState(false);
  const [targetDateFrom, setTargetDateFrom] = useState("");
  const [targetDateTo, setTargetDateTo] = useState("");
  const [targetTeamId, setTargetTeamId] = useState("");

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: users = [] } = useQuery<LookupUser[]>({
    queryKey: ["lookup-users-commissions"],
    queryFn: () => fetch("/api/lookup/users").then(r => r.json()).then(r => r.data ?? []),
    enabled: canFilterUsers,
  });

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: Commission[]; totalAmount: number }>({
    queryKey: ["commissions", qs],
    queryFn: () => fetch(`/api/commissions?${qs}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  // Target performance query
  const targetQs = new URLSearchParams();
  if (targetDateFrom) targetQs.set("dateFrom", targetDateFrom);
  if (targetDateTo) targetQs.set("dateTo", targetDateTo);
  if (targetTeamId) targetQs.set("teamId", targetTeamId);

  const { data: targetData, isLoading: targetLoading } = useQuery<{
    data: TargetEntry[];
    periodStart: string;
    periodEnd: string;
  }>({
    queryKey: ["target-performance", targetQs.toString()],
    queryFn: () => fetch(`/api/reports/target-performance?${targetQs.toString()}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CommissionStatus }) => {
      const res = await fetch(`/api/commissions/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل التحديث");
      return json.data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commissions"] }); toast.success("تم تحديث الحالة"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const commissions = data?.data ?? [];
  const total = data?.totalAmount ?? 0;
  const targets = targetData?.data ?? [];

  // Summary stats for targets
  const withTarget = targets.filter((t) => t.targetAchievement !== null);
  const avgAchievement =
    withTarget.length > 0
      ? Math.round(withTarget.reduce((s, t) => s + (t.targetAchievement ?? 0), 0) / withTarget.length)
      : null;
  const totalCommissions = targets.reduce((s, t) => s + t.commissionAmount, 0);
  const aboveTarget = withTarget.filter((t) => (t.targetAchievement ?? 0) >= 80).length;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="h-6 w-6" />
          العمولات والتارجت
        </h1>
        {isReadonly && (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            صلاحية عرض فقط
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { key: "targets" as const, label: "نسب تحقيق التارجت", icon: <Target className="h-4 w-4" /> },
          { key: "commissions" as const, label: "سجل العمولات", icon: <DollarSign className="h-4 w-4" /> },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── Target Achievement Tab ── */}
      {activeTab === "targets" && (
        <div className="space-y-6">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">من تاريخ (الشهر الحالي افتراضياً)</Label>
                  <Popover open={targetDateFromOpen} onOpenChange={setTargetDateFromOpen}>
                    <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                      <span>{targetDateFrom || "بداية الشهر"}</span><CalendarIcon className="h-4 w-4 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={targetDateFrom ? new Date(targetDateFrom) : undefined}
                        onDayClick={(d) => { setTargetDateFrom(format(d, "yyyy-MM-dd")); setTargetDateFromOpen(false); }} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">إلى تاريخ</Label>
                  <Popover open={targetDateToOpen} onOpenChange={setTargetDateToOpen}>
                    <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                      <span>{targetDateTo || "نهاية الشهر"}</span><CalendarIcon className="h-4 w-4 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={targetDateTo ? new Date(targetDateTo) : undefined}
                        onDayClick={(d) => { setTargetDateTo(format(d, "yyyy-MM-dd")); setTargetDateToOpen(false); }} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">الفريق</Label>
                  <SearchableSelect
                    options={[{ value: "", label: "كل الفرق" }]}
                    value={targetTeamId}
                    onChange={setTargetTeamId}
                    placeholder="كل الفرق"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          {!targetLoading && targets.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "الموظفون", value: targets.length, icon: <Users className="h-5 w-5 text-blue-500" />, color: "text-blue-700" },
                { label: "متوسط التحقيق", value: avgAchievement !== null ? `${avgAchievement}%` : "—", icon: <TrendingUp className="h-5 w-5 text-purple-500" />, color: avgAchievement === null ? "text-gray-600" : avgAchievement >= 80 ? "text-green-700" : avgAchievement >= 50 ? "text-yellow-700" : "text-red-600" },
                { label: "حققوا >80%", value: aboveTarget, icon: <Target className="h-5 w-5 text-green-500" />, color: "text-green-700" },
                { label: "إجمالي العمولات", value: totalCommissions.toLocaleString(), icon: <DollarSign className="h-5 w-5 text-amber-500" />, color: "text-amber-700" },
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
          )}

          {/* Period label */}
          {targetData && (
            <p className="text-sm text-muted-foreground">
              الفترة: {format(new Date(targetData.periodStart), "dd/MM/yyyy", { locale: arSA })} — {format(new Date(targetData.periodEnd), "dd/MM/yyyy", { locale: arSA })}
            </p>
          )}

          {/* Cards grid */}
          {targetLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : targets.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">لا توجد بيانات</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {targets.map((entry) => (
                <TargetCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Commissions Tab ── */}
      {activeTab === "commissions" && (
        <div className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {canFilterUsers && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">الموظف</Label>
                    <SearchableSelect
                      options={[{ value: "", label: "الكل" }, ...users.map(u => ({ value: u.id, label: u.name, sublabel: ROLE_LABELS[u.role] }))]}
                      value={filterUserId} onChange={v => updateParam("userId", v || null)} placeholder="كل الموظفين"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">الحالة</Label>
                  <SearchableSelect
                    options={[
                      { value: "", label: "الكل" },
                      { value: "PENDING", label: "معلق" },
                      { value: "APPROVED", label: "موافق عليه" },
                      { value: "PAID", label: "مدفوع" },
                    ]}
                    value={filterStatus} onChange={v => updateParam("status", v || null)} placeholder="كل الحالات"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">من تاريخ</Label>
                  <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                    <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                      <span>{dateFrom || "اختر تاريخاً"}</span><CalendarIcon className="h-4 w-4 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={dateFrom ? new Date(dateFrom) : undefined}
                        onDayClick={d => { updateParam("dateFrom", format(d,"yyyy-MM-dd")); setDateFromOpen(false); }} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">إلى تاريخ</Label>
                  <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                    <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                      <span>{dateTo || "اختر تاريخاً"}</span><CalendarIcon className="h-4 w-4 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={dateTo ? new Date(dateTo) : undefined}
                        onDayClick={d => { updateParam("dateTo", format(d,"yyyy-MM-dd")); setDateToOpen(false); }} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead className="text-center">الطلبات المسلمة</TableHead>
                    <TableHead>القاعدة</TableHead>
                    <TableHead className="text-end">المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                    {isAdmin && <TableHead>إجراء</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 7 : 6} className="text-center py-12 text-muted-foreground">
                        لا توجد عمولات
                      </TableCell>
                    </TableRow>
                  ) : commissions.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.user.name}</div>
                        <div className="text-xs text-muted-foreground">{ROLE_LABELS[c.user.role]}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(c.periodStart),"dd/MM/yyyy",{locale:arSA})} — {format(new Date(c.periodEnd),"dd/MM/yyyy",{locale:arSA})}
                      </TableCell>
                      <TableCell className="text-center font-mono">{c.totalDeliveredOrders}</TableCell>
                      <TableCell className="text-sm">{c.rule.name}</TableCell>
                      <TableCell className="text-end font-bold">
                        {c.commissionAmount.toLocaleString()} {c.currency.code}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[c.status])}>
                          {STATUS_LABELS[c.status]}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {NEXT_STATUS[c.status] ? (
                            <button
                              className="text-xs text-primary hover:underline disabled:opacity-50"
                              disabled={updateStatus.isPending}
                              onClick={() => updateStatus.mutate({ id: c.id, status: NEXT_STATUS[c.status]! })}
                            >
                              {NEXT_LABEL[c.status]}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                {commissions.length > 0 && (
                  <tfoot>
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell colSpan={isAdmin ? 4 : 3}>الإجمالي</TableCell>
                      <TableCell className="text-end font-bold">{total.toLocaleString()}</TableCell>
                      <TableCell colSpan={isAdmin ? 2 : 1} />
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommissionsReportPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <CommissionsInner />
    </Suspense>
  );
}
