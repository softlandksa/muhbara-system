"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays, startOfDay } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  Loader2, CalendarIcon, ClipboardList, Users, AlertTriangle, Clock,
  Lock, Pencil, PlusCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type DailyReport = {
  id: string;
  reportDate: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  reportData: Record<string, unknown> | null;
  notes: string | null;
  createdAt: string;
  user: { id: string; name: string; role: Role };
};

type ReportsResponse = {
  data: DailyReport[];
  missingToday: { id: string; name: string; role: string }[];
};

type LookupUser = { id: string; name: string; role: Role };

// ─── Report data labels per role ─────────────────────────────────────────────

const SALES_LABELS: Record<string, string> = {
  newCustomers: "عدد العملاء الجدد",
  returningCustomers: "عدد العملاء السابقين",
  salesCount: "عمليات البيع",
  respondedCustomers: "العملاء المستجيبين",
  noAnswerCustomers: "لم يردوا",
  rejectedCustomers: "رفضوا الشراء",
  topObjections: "أبرز الاعتراضات",
  improvementSuggestion: "مقترح تطوير الأداء",
};

const MANAGER_LABELS: Record<string, string> = {
  teamNewCustomers: "إجمالي العملاء الجدد للفريق",
  teamReturningCustomers: "إجمالي العملاء السابقين للفريق",
  teamSalesCount: "إجمالي عمليات البيع للفريق",
  teamRespondedCustomers: "إجمالي المستجيبين",
  teamNoAnswerCustomers: "إجمالي الذين لم يردوا",
  teamRejectedCustomers: "إجمالي الرافضين",
  topObjections: "أبرز الاعتراضات",
  teamImprovementSuggestion: "مقترح تطوير أداء الفريق",
};

const SHIPPING_LABELS: Record<string, string> = {
  dailyOrders: "طلبات اليوم",
  issuedBills: "البوليصات المصدرة",
  delayedOrders: "الطلبات المتأخرة",
  delayReason: "سبب التأخير",
  ordersAtCompany: "طلبات عند شركات الشحن",
  returnedOrders: "المرتجعات",
  notes: "ملاحظات",
  improvementSuggestion: "مقترحات تحسين الأداء",
};

function labelsForRole(role: Role): Record<string, string> {
  if (role === "SALES" || role === "SUPPORT" || role === "FOLLOWUP") return SALES_LABELS;
  if (role === "SALES_MANAGER") return MANAGER_LABELS;
  if (role === "SHIPPING") return SHIPPING_LABELS;
  return SALES_LABELS;
}

// ─── Time Picker ──────────────────────────────────────────────────────────────

function TimePicker({
  value,
  onChange,
  placeholder = "اختر الوقت",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const curHour = value ? value.split(":")[0] : "";
  const curMin = value ? value.split(":")[1] : "";

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

  return (
    <Popover open={open && !disabled} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger
        className={cn(
          "flex h-9 w-full items-center justify-start gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors font-normal",
          !disabled && "hover:bg-accent hover:text-accent-foreground",
          !value && "text-muted-foreground",
          disabled && "opacity-60 cursor-default"
        )}
      >
        <Clock className="h-4 w-4 shrink-0" />
        {value || placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" dir="rtl">
        <p className="text-xs text-muted-foreground mb-2 text-center">اختر الساعة والدقيقة</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs font-medium text-center mb-1">الساعة</p>
            <ScrollArea className="h-44 rounded border">
              <div className="py-1">
                {hours.map((h) => (
                  <button
                    key={h}
                    onClick={() => {
                      const m = curMin || "00";
                      onChange(`${h}:${m}`);
                      if (curMin) setOpen(false);
                    }}
                    className={cn(
                      "w-full py-1.5 text-sm text-center hover:bg-muted rounded-sm",
                      curHour === h && "bg-primary text-primary-foreground hover:bg-primary"
                    )}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
          <div>
            <p className="text-xs font-medium text-center mb-1">الدقائق</p>
            <ScrollArea className="h-44 rounded border">
              <div className="py-1">
                {minutes.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      const h = curHour || "09";
                      onChange(`${h}:${m}`);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full py-1.5 text-sm text-center hover:bg-muted rounded-sm",
                      curMin === m && "bg-primary text-primary-foreground hover:bg-primary"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
        {value && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 text-muted-foreground"
            onClick={() => { onChange(""); setOpen(false); }}
          >
            مسح
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Numeric Input Helper ─────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
        className="text-center"
        disabled={disabled}
      />
    </div>
  );
}

// ─── Form Props ───────────────────────────────────────────────────────────────

type FormProps = {
  selectedDate: string;
  existingReport: DailyReport | undefined;
  isReadOnly: boolean;
};

// ─── Sales / Support Form ─────────────────────────────────────────────────────

function SalesReportForm({ selectedDate, existingReport, isReadOnly }: FormProps) {
  const queryClient = useQueryClient();
  const existing = existingReport?.reportData as Record<string, unknown> | null ?? {};

  const [shiftStart, setShiftStart] = useState(existingReport?.shiftStart ?? "");
  const [shiftEnd, setShiftEnd] = useState(existingReport?.shiftEnd ?? "");
  const [newCustomers, setNewCustomers] = useState<number | "">(Number(existing.newCustomers ?? 0));
  const [returningCustomers, setReturningCustomers] = useState<number | "">(Number(existing.returningCustomers ?? 0));
  const [salesCount, setSalesCount] = useState<number | "">(Number(existing.salesCount ?? 0));
  const [respondedCustomers, setRespondedCustomers] = useState<number | "">(Number(existing.respondedCustomers ?? 0));
  const [noAnswerCustomers, setNoAnswerCustomers] = useState<number | "">(Number(existing.noAnswerCustomers ?? 0));
  const [rejectedCustomers, setRejectedCustomers] = useState<number | "">(Number(existing.rejectedCustomers ?? 0));
  const [topObjections, setTopObjections] = useState(String(existing.topObjections ?? ""));
  const [improvementSuggestion, setImprovementSuggestion] = useState(String(existing.improvementSuggestion ?? ""));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/daily-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportDate: selectedDate,
          shiftStart: shiftStart || undefined,
          shiftEnd: shiftEnd || undefined,
          reportData: {
            newCustomers: newCustomers || 0,
            returningCustomers: returningCustomers || 0,
            salesCount: salesCount || 0,
            respondedCustomers: respondedCustomers || 0,
            noAnswerCustomers: noAnswerCustomers || 0,
            rejectedCustomers: rejectedCustomers || 0,
            topObjections,
            improvementSuggestion,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل حفظ التقرير");
      return json.data;
    },
    onSuccess: () => {
      toast.success(existingReport ? "تم تحديث التقرير" : "تم حفظ التقرير بنجاح");
      queryClient.invalidateQueries({ queryKey: ["my-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          تقريري اليومي
          {isReadOnly && (
            <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
              <Lock className="h-3 w-3" />عرض فقط
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>وقت بداية الشيفت</Label>
            <TimePicker value={shiftStart} onChange={setShiftStart} placeholder="مثال: 09:00" disabled={isReadOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>وقت نهاية الشيفت</Label>
            <TimePicker value={shiftEnd} onChange={setShiftEnd} placeholder="مثال: 17:00" disabled={isReadOnly} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <NumField label="عدد العملاء الجدد" value={newCustomers} onChange={setNewCustomers} disabled={isReadOnly} />
          <NumField label="عدد العملاء السابقين" value={returningCustomers} onChange={setReturningCustomers} disabled={isReadOnly} />
          <NumField label="عمليات البيع" value={salesCount} onChange={setSalesCount} disabled={isReadOnly} />
          <NumField label="العملاء المستجيبين" value={respondedCustomers} onChange={setRespondedCustomers} disabled={isReadOnly} />
          <NumField label="العملاء الذين لم يردوا" value={noAnswerCustomers} onChange={setNoAnswerCustomers} disabled={isReadOnly} />
          <NumField label="رفضوا الشراء مباشرة" value={rejectedCustomers} onChange={setRejectedCustomers} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>أبرز اعتراضات العملاء اليوم</Label>
          <Textarea value={topObjections} onChange={(e) => setTopObjections(e.target.value)}
            placeholder="اذكر أبرز الاعتراضات التي واجهتها..." rows={3} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>مقترح تطوير الأداء</Label>
          <Textarea value={improvementSuggestion} onChange={(e) => setImprovementSuggestion(e.target.value)}
            placeholder="اقتراحاتك لتحسين الأداء..." rows={2} disabled={isReadOnly} />
        </div>
        {!isReadOnly && (
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            {existingReport ? "تحديث التقرير" : "حفظ التقرير"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sales Manager Form ───────────────────────────────────────────────────────

function ManagerReportForm({ selectedDate, existingReport, isReadOnly }: FormProps) {
  const queryClient = useQueryClient();
  const existing = existingReport?.reportData as Record<string, unknown> | null ?? {};

  const [shiftStart, setShiftStart] = useState(existingReport?.shiftStart ?? "");
  const [shiftEnd, setShiftEnd] = useState(existingReport?.shiftEnd ?? "");
  const [teamNewCustomers, setTeamNewCustomers] = useState<number | "">(Number(existing.teamNewCustomers ?? 0));
  const [teamReturningCustomers, setTeamReturningCustomers] = useState<number | "">(Number(existing.teamReturningCustomers ?? 0));
  const [teamSalesCount, setTeamSalesCount] = useState<number | "">(Number(existing.teamSalesCount ?? 0));
  const [teamRespondedCustomers, setTeamRespondedCustomers] = useState<number | "">(Number(existing.teamRespondedCustomers ?? 0));
  const [teamNoAnswerCustomers, setTeamNoAnswerCustomers] = useState<number | "">(Number(existing.teamNoAnswerCustomers ?? 0));
  const [teamRejectedCustomers, setTeamRejectedCustomers] = useState<number | "">(Number(existing.teamRejectedCustomers ?? 0));
  const [topObjections, setTopObjections] = useState(String(existing.topObjections ?? ""));
  const [teamImprovementSuggestion, setTeamImprovementSuggestion] = useState(String(existing.teamImprovementSuggestion ?? ""));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/daily-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportDate: selectedDate,
          shiftStart: shiftStart || undefined,
          shiftEnd: shiftEnd || undefined,
          reportData: {
            teamNewCustomers: teamNewCustomers || 0,
            teamReturningCustomers: teamReturningCustomers || 0,
            teamSalesCount: teamSalesCount || 0,
            teamRespondedCustomers: teamRespondedCustomers || 0,
            teamNoAnswerCustomers: teamNoAnswerCustomers || 0,
            teamRejectedCustomers: teamRejectedCustomers || 0,
            topObjections,
            teamImprovementSuggestion,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل حفظ التقرير");
      return json.data;
    },
    onSuccess: () => {
      toast.success(existingReport ? "تم تحديث التقرير" : "تم حفظ التقرير بنجاح");
      queryClient.invalidateQueries({ queryKey: ["my-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          تقرير مدير الفريق
          {isReadOnly && (
            <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
              <Lock className="h-3 w-3" />عرض فقط
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>وقت بداية الشيفت</Label>
            <TimePicker value={shiftStart} onChange={setShiftStart} disabled={isReadOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>وقت نهاية الشيفت</Label>
            <TimePicker value={shiftEnd} onChange={setShiftEnd} disabled={isReadOnly} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <NumField label="إجمالي العملاء الجدد للفريق" value={teamNewCustomers} onChange={setTeamNewCustomers} disabled={isReadOnly} />
          <NumField label="إجمالي العملاء السابقين للفريق" value={teamReturningCustomers} onChange={setTeamReturningCustomers} disabled={isReadOnly} />
          <NumField label="إجمالي عمليات البيع للفريق" value={teamSalesCount} onChange={setTeamSalesCount} disabled={isReadOnly} />
          <NumField label="إجمالي العملاء المستجيبين" value={teamRespondedCustomers} onChange={setTeamRespondedCustomers} disabled={isReadOnly} />
          <NumField label="إجمالي الذين لم يردوا" value={teamNoAnswerCustomers} onChange={setTeamNoAnswerCustomers} disabled={isReadOnly} />
          <NumField label="إجمالي الرافضين للشراء" value={teamRejectedCustomers} onChange={setTeamRejectedCustomers} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>أبرز اعتراضات العملاء اليوم</Label>
          <Textarea value={topObjections} onChange={(e) => setTopObjections(e.target.value)}
            placeholder="أبرز الاعتراضات المتكررة في الفريق..." rows={3} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>مقترح تطوير أداء الفريق</Label>
          <Textarea value={teamImprovementSuggestion} onChange={(e) => setTeamImprovementSuggestion(e.target.value)}
            placeholder="اقتراحاتك لتطوير أداء الفريق..." rows={2} disabled={isReadOnly} />
        </div>
        {!isReadOnly && (
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            {existingReport ? "تحديث التقرير" : "حفظ التقرير"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shipping Form ────────────────────────────────────────────────────────────

function ShippingReportForm({ selectedDate, existingReport, isReadOnly }: FormProps) {
  const queryClient = useQueryClient();
  const existing = existingReport?.reportData as Record<string, unknown> | null ?? {};

  const [dailyOrders, setDailyOrders] = useState<number | "">(Number(existing.dailyOrders ?? 0));
  const [issuedBills, setIssuedBills] = useState<number | "">(Number(existing.issuedBills ?? 0));
  const [delayedOrders, setDelayedOrders] = useState<number | "">(Number(existing.delayedOrders ?? 0));
  const [delayReason, setDelayReason] = useState(String(existing.delayReason ?? ""));
  const [ordersAtCompany, setOrdersAtCompany] = useState<number | "">(Number(existing.ordersAtCompany ?? 0));
  const [returnedOrders, setReturnedOrders] = useState<number | "">(Number(existing.returnedOrders ?? 0));
  const [notes, setNotes] = useState(String(existing.notes ?? ""));
  const [improvementSuggestion, setImprovementSuggestion] = useState(String(existing.improvementSuggestion ?? ""));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/daily-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportDate: selectedDate,
          reportData: {
            dailyOrders: dailyOrders || 0,
            issuedBills: issuedBills || 0,
            delayedOrders: delayedOrders || 0,
            delayReason,
            ordersAtCompany: ordersAtCompany || 0,
            returnedOrders: returnedOrders || 0,
            notes,
            improvementSuggestion,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل حفظ التقرير");
      return json.data;
    },
    onSuccess: () => {
      toast.success(existingReport ? "تم تحديث التقرير" : "تم حفظ التقرير بنجاح");
      queryClient.invalidateQueries({ queryKey: ["my-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          تقرير الشحن
          {isReadOnly && (
            <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
              <Lock className="h-3 w-3" />عرض فقط
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <NumField label="عدد طلبات اليوم" value={dailyOrders} onChange={setDailyOrders} disabled={isReadOnly} />
          <NumField label="عدد البوليصات المصدرة" value={issuedBills} onChange={setIssuedBills} disabled={isReadOnly} />
          <NumField label="الطلبات المتأخرة عن الشحن" value={delayedOrders} onChange={setDelayedOrders} disabled={isReadOnly} />
          <NumField label="كم طلب عند شركات الشحن" value={ordersAtCompany} onChange={setOrdersAtCompany} disabled={isReadOnly} />
          <NumField label="مرتجعات اليوم" value={returnedOrders} onChange={setReturnedOrders} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>سبب تأخير الطلبات المتأخرة</Label>
          <Textarea value={delayReason} onChange={(e) => setDelayReason(e.target.value)}
            placeholder="سبب التأخير (إن وجد)..." rows={2} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="أي ملاحظات عامة..." rows={2} disabled={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label>مقترحات تحسين الأداء</Label>
          <Textarea value={improvementSuggestion} onChange={(e) => setImprovementSuggestion(e.target.value)}
            placeholder="اقتراحاتك لتحسين الأداء..." rows={2} disabled={isReadOnly} />
        </div>
        {!isReadOnly && (
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            {existingReport ? "تحديث التقرير" : "حفظ التقرير"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Report Data Display ──────────────────────────────────────────────────────

function ReportDataDisplay({ report }: { report: DailyReport }) {
  const data = report.reportData as Record<string, unknown> | null;
  const labels = labelsForRole(report.user.role);

  if (!data || Object.keys(data).length === 0) {
    return <span className="text-muted-foreground text-xs">لا توجد بيانات</span>;
  }

  const numericKeys = Object.keys(labels).filter((k) => typeof data[k] === "number");
  const textKeys = Object.keys(labels).filter(
    (k) => typeof data[k] === "string" && (data[k] as string).length > 0
  );

  return (
    <div className="space-y-2 text-sm">
      {(report.shiftStart || report.shiftEnd) && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {report.shiftStart && <span>بداية: {report.shiftStart}</span>}
          {report.shiftEnd && <span>نهاية: {report.shiftEnd}</span>}
        </div>
      )}
      {numericKeys.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {numericKeys.map((k) => (
            <span key={k} className="text-xs">
              <span className="text-muted-foreground">{labels[k]}: </span>
              <span className="font-medium">{String(data[k])}</span>
            </span>
          ))}
        </div>
      )}
      {textKeys.map((k) => (
        <div key={k}>
          <span className="text-xs font-medium text-muted-foreground">{labels[k]}: </span>
          <span className="text-xs">{String(data[k])}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function SelfReportsInner() {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  // Viewers (managers/admin/HR) see read-only table of submitted FOLLOWUP reports
  const isViewer = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "HR";
  // Only FOLLOWUP employees may submit self-reports
  const canSubmit = role === "FOLLOWUP";

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const filterUserId = searchParams.get("userId") ?? "";

  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  // ── Date picker for the employee's own report ──
  const today = format(new Date(), "yyyy-MM-dd");
  const sevenDaysAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);
  const [reportDatePickerOpen, setReportDatePickerOpen] = useState(false);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: employees = [] } = useQuery<LookupUser[]>({
    queryKey: ["lookup-users-all"],
    queryFn: () => fetch("/api/lookup/users").then((r) => r.json()).then((r) => r.data ?? []),
    enabled: isViewer,
  });

  // Viewer's filtered reports table
  const queryStr = searchParams.toString();
  const { data: viewerData, isLoading: viewerLoading } = useQuery<ReportsResponse>({
    queryKey: ["self-reports", queryStr],
    queryFn: () => fetch(`/api/daily-reports?${queryStr}`).then((r) => r.json()),
    enabled: isViewer,
  });

  // Employee's own reports (last 30 days) — used for form pre-fill + past reports list
  const thirtyDaysAgoStr = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const { data: myReportsData, isLoading: myReportsLoading } = useQuery<ReportsResponse>({
    queryKey: ["my-reports"],
    queryFn: () => fetch(`/api/daily-reports?dateFrom=${thirtyDaysAgoStr}`).then((r) => r.json()),
    enabled: canSubmit && !!session,
  });
  const myReports = myReportsData?.data ?? [];

  const allViewerReports = viewerData?.data ?? [];
  const missingToday = viewerData?.missingToday ?? [];

  // Find existing report for the selected date
  const existingReport = myReports.find((r) => r.reportDate.startsWith(selectedDate));
  const isEditing = !!existingReport;
  // Read-only if the date is older than 7 days (before 7-days-ago, exclusive)
  const isReadOnly = selectedDate < sevenDaysAgo;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          التقارير الذاتية للموظفين
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          تقارير مقدمة من الموظف — تعكس ما قدمه الموظف بنفسه
        </p>
      </div>

      {/* ── Date picker card (employee only) ── */}
      {canSubmit && (
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5 flex-1 min-w-[220px]">
                <Label className="font-medium">تاريخ التقرير</Label>
                <Popover open={reportDatePickerOpen} onOpenChange={setReportDatePickerOpen}>
                  <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground">
                    <span className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      {format(new Date(selectedDate + "T00:00:00"), "EEEE، dd MMMM yyyy", { locale: arSA })}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={new Date(selectedDate + "T00:00:00")}
                      onDayClick={(d) => {
                        setSelectedDate(format(d, "yyyy-MM-dd"));
                        setReportDatePickerOpen(false);
                      }}
                      disabled={(date) => {
                        const d = startOfDay(date);
                        const todayStart = startOfDay(new Date());
                        const minDate = startOfDay(subDays(new Date(), 7));
                        return d > todayStart || d < minDate;
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">يمكن اختيار أي يوم خلال آخر 7 أيام</p>
              </div>

              <div className="flex items-center gap-2 pb-1">
                {isReadOnly ? (
                  <Badge variant="outline" className="gap-1 text-muted-foreground border-muted">
                    <Lock className="h-3 w-3" />
                    عرض فقط — أقدم من 7 أيام
                  </Badge>
                ) : isEditing ? (
                  <Badge variant="secondary" className="gap-1">
                    <Pencil className="h-3 w-3" />
                    تعديل تقرير سابق
                  </Badge>
                ) : (
                  <Badge className="gap-1 bg-green-600 hover:bg-green-600 text-white">
                    <PlusCircle className="h-3 w-3" />
                    تقرير جديد
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Submission form — FOLLOWUP employees only ── */}
      {canSubmit && (
        <SalesReportForm
          key={selectedDate}
          selectedDate={selectedDate}
          existingReport={existingReport}
          isReadOnly={isReadOnly}
        />
      )}

      {/* ── Employee's past reports list ── */}
      {canSubmit && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            تقاريري السابقة
            {myReports.length > 0 && <Badge variant="secondary">{myReports.length}</Badge>}
          </h2>
          {myReportsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : myReports.length === 0 ? (
            <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
              لا توجد تقارير مسبقة
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الشيفت</TableHead>
                    <TableHead>البيانات الرئيسية</TableHead>
                    <TableHead className="text-center w-24">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myReports.map((report) => {
                    const rDate = report.reportDate.slice(0, 10);
                    const locked = rDate < sevenDaysAgo;
                    const isSelected = selectedDate === rDate;
                    return (
                      <TableRow
                        key={report.id}
                        onClick={() => setSelectedDate(rDate)}
                        className={cn(
                          "cursor-pointer align-top transition-colors",
                          isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/20"
                        )}
                      >
                        <TableCell className="whitespace-nowrap">
                          <div className="font-medium text-sm">
                            {format(new Date(rDate + "T00:00:00"), "dd/MM/yyyy", { locale: arSA })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(rDate + "T00:00:00"), "EEEE", { locale: arSA })}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {report.shiftStart || report.shiftEnd ? (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {report.shiftStart ?? "—"} → {report.shiftEnd ?? "—"}
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="max-w-[360px]">
                          <ReportDataDisplay report={report} />
                        </TableCell>
                        <TableCell className="text-center">
                          {locked ? (
                            <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                              <Lock className="h-3 w-3" />عرض
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <Pencil className="h-3 w-3" />تعديل
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── Viewer: missing reporters alert ── */}
      {isViewer && missingToday.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2 text-orange-800">
              <AlertTriangle className="h-4 w-4" />
              لم يقدموا تقرير اليوم ({missingToday.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {missingToday.map((u) => (
                <Badge key={u.id} variant="outline" className="border-orange-300 text-orange-700 bg-white">
                  {u.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Viewer: filters ── */}
      {isViewer && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الموظف</Label>
                <SearchableSelect
                  options={[
                    { value: "", label: "الكل" },
                    ...employees.map((e) => ({ value: e.id, label: e.name, sublabel: ROLE_LABELS[e.role] })),
                  ]}
                  value={filterUserId}
                  onChange={(v) => updateParam("userId", v || null)}
                  placeholder="كل الموظفين"
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
      )}

      {/* ── Viewer: reports table ── */}
      {isViewer && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            تقارير الموظفين
            {allViewerReports.length > 0 && <Badge variant="secondary">{allViewerReports.length}</Badge>}
          </h2>

          {viewerLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : allViewerReports.length === 0 ? (
            <div className="rounded-lg border py-12 text-center text-muted-foreground">
              لا توجد تقارير
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الشيفت</TableHead>
                    <TableHead>البيانات</TableHead>
                    <TableHead>الدور</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allViewerReports.map((report) => (
                    <TableRow key={report.id} className="align-top">
                      <TableCell className="font-medium whitespace-nowrap">{report.user.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(report.reportDate), "dd/MM/yyyy", { locale: arSA })}
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(report.reportDate), "EEEE", { locale: arSA })}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {report.shiftStart || report.shiftEnd ? (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {report.shiftStart ?? "—"} → {report.shiftEnd ?? "—"}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[400px]">
                        <ReportDataDisplay report={report} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {ROLE_LABELS[report.user.role]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SelfReportsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <SelfReportsInner />
    </Suspense>
  );
}
