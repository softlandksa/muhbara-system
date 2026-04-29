"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  Loader2, CalendarIcon, FileText, Users, AlertTriangle, Clock,
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const curHour = value ? value.split(":")[0] : "";
  const curMin = value ? value.split(":")[1] : "";

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-9 w-full items-center justify-start gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground font-normal",
          !value && "text-muted-foreground"
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

// ─── Date Window Picker ───────────────────────────────────────────────────────

function DateWindowPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() - 3);

  return (
    <div className="space-y-1.5">
      <Label>تاريخ التقرير</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground">
          <span>{value ? format(new Date(value), "EEEE، dd MMMM yyyy", { locale: arSA }) : "اختر التاريخ"}</span>
          <CalendarIcon className="h-4 w-4 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" dir="rtl">
          <Calendar
            mode="single"
            selected={value ? new Date(value) : undefined}
            onDayClick={(d) => {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }}
            disabled={[{ before: minDate }, { after: today }]}
            locale={arSA}
          />
          <p className="text-xs text-muted-foreground text-center pb-2 px-3">
            يمكن اختيار تاريخ اليوم أو حتى 3 أيام للخلف فقط
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Numeric Input Helper ─────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
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
      />
    </div>
  );
}

// ─── Sales / Support Form ─────────────────────────────────────────────────────

function SalesReportForm({ allReports }: { allReports: DailyReport[] }) {
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");
  const [newCustomers, setNewCustomers] = useState<number | "">(0);
  const [returningCustomers, setReturningCustomers] = useState<number | "">(0);
  const [salesCount, setSalesCount] = useState<number | "">(0);
  const [respondedCustomers, setRespondedCustomers] = useState<number | "">(0);
  const [noAnswerCustomers, setNoAnswerCustomers] = useState<number | "">(0);
  const [rejectedCustomers, setRejectedCustomers] = useState<number | "">(0);
  const [topObjections, setTopObjections] = useState("");
  const [improvementSuggestion, setImprovementSuggestion] = useState("");

  const existingReport = allReports.find((r) => r.reportDate.startsWith(selectedDate));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const rep = allReports.find((r) => r.reportDate.startsWith(selectedDate));
    const data = rep?.reportData as Record<string, unknown> | null ?? {};
    setShiftStart(rep?.shiftStart ?? "");
    setShiftEnd(rep?.shiftEnd ?? "");
    setNewCustomers(Number(data.newCustomers ?? 0));
    setReturningCustomers(Number(data.returningCustomers ?? 0));
    setSalesCount(Number(data.salesCount ?? 0));
    setRespondedCustomers(Number(data.respondedCustomers ?? 0));
    setNoAnswerCustomers(Number(data.noAnswerCustomers ?? 0));
    setRejectedCustomers(Number(data.rejectedCustomers ?? 0));
    setTopObjections(String(data.topObjections ?? ""));
    setImprovementSuggestion(String(data.improvementSuggestion ?? ""));
  }, [selectedDate, allReports]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      queryClient.invalidateQueries({ queryKey: ["daily-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          تقرير الموظف
          {existingReport && <Badge variant="secondary" className="text-xs">تم التقديم</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <DateWindowPicker value={selectedDate} onChange={setSelectedDate} />

        {/* Shift times */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>وقت بداية الشيفت</Label>
            <TimePicker value={shiftStart} onChange={setShiftStart} placeholder="مثال: 09:00" />
          </div>
          <div className="space-y-1.5">
            <Label>وقت نهاية الشيفت</Label>
            <TimePicker value={shiftEnd} onChange={setShiftEnd} placeholder="مثال: 17:00" />
          </div>
        </div>

        {/* Number fields */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <NumField label="عدد العملاء الجدد" value={newCustomers} onChange={setNewCustomers} />
          <NumField label="عدد العملاء السابقين" value={returningCustomers} onChange={setReturningCustomers} />
          <NumField label="عمليات البيع" value={salesCount} onChange={setSalesCount} />
          <NumField label="العملاء المستجيبين" value={respondedCustomers} onChange={setRespondedCustomers} />
          <NumField label="العملاء الذين لم يردوا" value={noAnswerCustomers} onChange={setNoAnswerCustomers} />
          <NumField label="رفضوا الشراء مباشرة" value={rejectedCustomers} onChange={setRejectedCustomers} />
        </div>

        {/* Text fields */}
        <div className="space-y-1.5">
          <Label>أبرز اعتراضات العملاء اليوم</Label>
          <Textarea
            value={topObjections}
            onChange={(e) => setTopObjections(e.target.value)}
            placeholder="اذكر أبرز الاعتراضات التي واجهتها..."
            rows={3}
          />
        </div>
        <div className="space-y-1.5">
          <Label>مقترح تطوير الأداء</Label>
          <Textarea
            value={improvementSuggestion}
            onChange={(e) => setImprovementSuggestion(e.target.value)}
            placeholder="اقتراحاتك لتحسين الأداء..."
            rows={2}
          />
        </div>

        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
          {existingReport ? "تحديث التقرير" : "حفظ التقرير"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Sales Manager Form ───────────────────────────────────────────────────────

function ManagerReportForm({ allReports }: { allReports: DailyReport[] }) {
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");
  const [teamNewCustomers, setTeamNewCustomers] = useState<number | "">(0);
  const [teamReturningCustomers, setTeamReturningCustomers] = useState<number | "">(0);
  const [teamSalesCount, setTeamSalesCount] = useState<number | "">(0);
  const [teamRespondedCustomers, setTeamRespondedCustomers] = useState<number | "">(0);
  const [teamNoAnswerCustomers, setTeamNoAnswerCustomers] = useState<number | "">(0);
  const [teamRejectedCustomers, setTeamRejectedCustomers] = useState<number | "">(0);
  const [topObjections, setTopObjections] = useState("");
  const [teamImprovementSuggestion, setTeamImprovementSuggestion] = useState("");

  const existingReport = allReports.find((r) => r.reportDate.startsWith(selectedDate));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const rep = allReports.find((r) => r.reportDate.startsWith(selectedDate));
    const data = rep?.reportData as Record<string, unknown> | null ?? {};
    setShiftStart(rep?.shiftStart ?? "");
    setShiftEnd(rep?.shiftEnd ?? "");
    setTeamNewCustomers(Number(data.teamNewCustomers ?? 0));
    setTeamReturningCustomers(Number(data.teamReturningCustomers ?? 0));
    setTeamSalesCount(Number(data.teamSalesCount ?? 0));
    setTeamRespondedCustomers(Number(data.teamRespondedCustomers ?? 0));
    setTeamNoAnswerCustomers(Number(data.teamNoAnswerCustomers ?? 0));
    setTeamRejectedCustomers(Number(data.teamRejectedCustomers ?? 0));
    setTopObjections(String(data.topObjections ?? ""));
    setTeamImprovementSuggestion(String(data.teamImprovementSuggestion ?? ""));
  }, [selectedDate, allReports]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      queryClient.invalidateQueries({ queryKey: ["daily-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          تقرير مدير الفريق
          {existingReport && <Badge variant="secondary" className="text-xs">تم التقديم</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <DateWindowPicker value={selectedDate} onChange={setSelectedDate} />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>وقت بداية الشيفت</Label>
            <TimePicker value={shiftStart} onChange={setShiftStart} />
          </div>
          <div className="space-y-1.5">
            <Label>وقت نهاية الشيفت</Label>
            <TimePicker value={shiftEnd} onChange={setShiftEnd} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <NumField label="إجمالي العملاء الجدد للفريق" value={teamNewCustomers} onChange={setTeamNewCustomers} />
          <NumField label="إجمالي العملاء السابقين للفريق" value={teamReturningCustomers} onChange={setTeamReturningCustomers} />
          <NumField label="إجمالي عمليات البيع للفريق" value={teamSalesCount} onChange={setTeamSalesCount} />
          <NumField label="إجمالي العملاء المستجيبين" value={teamRespondedCustomers} onChange={setTeamRespondedCustomers} />
          <NumField label="إجمالي الذين لم يردوا" value={teamNoAnswerCustomers} onChange={setTeamNoAnswerCustomers} />
          <NumField label="إجمالي الرافضين للشراء" value={teamRejectedCustomers} onChange={setTeamRejectedCustomers} />
        </div>

        <div className="space-y-1.5">
          <Label>أبرز اعتراضات العملاء اليوم</Label>
          <Textarea
            value={topObjections}
            onChange={(e) => setTopObjections(e.target.value)}
            placeholder="أبرز الاعتراضات المتكررة في الفريق..."
            rows={3}
          />
        </div>
        <div className="space-y-1.5">
          <Label>مقترح تطوير أداء الفريق</Label>
          <Textarea
            value={teamImprovementSuggestion}
            onChange={(e) => setTeamImprovementSuggestion(e.target.value)}
            placeholder="اقتراحاتك لتطوير أداء الفريق..."
            rows={2}
          />
        </div>

        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
          {existingReport ? "تحديث التقرير" : "حفظ التقرير"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Shipping Form ────────────────────────────────────────────────────────────

function ShippingReportForm({ allReports }: { allReports: DailyReport[] }) {
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [dailyOrders, setDailyOrders] = useState<number | "">(0);
  const [issuedBills, setIssuedBills] = useState<number | "">(0);
  const [delayedOrders, setDelayedOrders] = useState<number | "">(0);
  const [delayReason, setDelayReason] = useState("");
  const [ordersAtCompany, setOrdersAtCompany] = useState<number | "">(0);
  const [returnedOrders, setReturnedOrders] = useState<number | "">(0);
  const [notes, setNotes] = useState("");
  const [improvementSuggestion, setImprovementSuggestion] = useState("");

  const existingReport = allReports.find((r) => r.reportDate.startsWith(selectedDate));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const rep = allReports.find((r) => r.reportDate.startsWith(selectedDate));
    const data = rep?.reportData as Record<string, unknown> | null ?? {};
    setDailyOrders(Number(data.dailyOrders ?? 0));
    setIssuedBills(Number(data.issuedBills ?? 0));
    setDelayedOrders(Number(data.delayedOrders ?? 0));
    setDelayReason(String(data.delayReason ?? ""));
    setOrdersAtCompany(Number(data.ordersAtCompany ?? 0));
    setReturnedOrders(Number(data.returnedOrders ?? 0));
    setNotes(String(data.notes ?? ""));
    setImprovementSuggestion(String(data.improvementSuggestion ?? ""));
  }, [selectedDate, allReports]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      queryClient.invalidateQueries({ queryKey: ["daily-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          تقرير الشحن
          {existingReport && <Badge variant="secondary" className="text-xs">تم التقديم</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <DateWindowPicker value={selectedDate} onChange={setSelectedDate} />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <NumField label="عدد طلبات اليوم" value={dailyOrders} onChange={setDailyOrders} />
          <NumField label="عدد البوليصات المصدرة" value={issuedBills} onChange={setIssuedBills} />
          <NumField label="الطلبات المتأخرة عن الشحن" value={delayedOrders} onChange={setDelayedOrders} />
          <NumField label="كم طلب عند شركات الشحن" value={ordersAtCompany} onChange={setOrdersAtCompany} />
          <NumField label="مرتجعات اليوم" value={returnedOrders} onChange={setReturnedOrders} />
        </div>

        <div className="space-y-1.5">
          <Label>سبب تأخير الطلبات المتأخرة</Label>
          <Textarea
            value={delayReason}
            onChange={(e) => setDelayReason(e.target.value)}
            placeholder="سبب التأخير (إن وجد)..."
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label>ملاحظات</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="أي ملاحظات عامة..."
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label>مقترحات تحسين الأداء</Label>
          <Textarea
            value={improvementSuggestion}
            onChange={(e) => setImprovementSuggestion(e.target.value)}
            placeholder="اقتراحاتك لتحسين الأداء..."
            rows={2}
          />
        </div>

        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
          {existingReport ? "تحديث التقرير" : "حفظ التقرير"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Report Data Display (for manager table) ──────────────────────────────────

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
      {/* Shift times */}
      {(report.shiftStart || report.shiftEnd) && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {report.shiftStart && <span>بداية: {report.shiftStart}</span>}
          {report.shiftEnd && <span>نهاية: {report.shiftEnd}</span>}
        </div>
      )}
      {/* Numeric stats */}
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
      {/* Text fields */}
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

function DailyReportsInner() {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  const isManager = role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER";
  const canSubmit = role !== "ADMIN" && role !== "GENERAL_MANAGER";

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const filterUserId = searchParams.get("userId") ?? "";

  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: employees = [] } = useQuery<LookupUser[]>({
    queryKey: ["lookup-users-all"],
    queryFn: () => fetch("/api/lookup/users").then((r) => r.json()).then((r) => r.data ?? []),
    enabled: isManager,
  });

  const queryStr = searchParams.toString();
  const { data, isLoading } = useQuery<ReportsResponse>({
    queryKey: ["daily-reports", queryStr],
    queryFn: () => fetch(`/api/daily-reports?${queryStr}`).then((r) => r.json()),
  });

  const allReports = data?.data ?? [];
  const missingToday = data?.missingToday ?? [];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <FileText className="h-6 w-6" />
        التقارير اليومية
      </h1>

      {/* Role-specific submission form */}
      {canSubmit && role === "SALES_MANAGER" && (
        <ManagerReportForm allReports={allReports} />
      )}
      {canSubmit && (role === "SALES" || role === "SUPPORT" || role === "FOLLOWUP") && (
        <SalesReportForm allReports={allReports} />
      )}
      {canSubmit && role === "SHIPPING" && (
        <ShippingReportForm allReports={allReports} />
      )}

      {/* Missing reporters (manager only) */}
      {isManager && missingToday.length > 0 && (
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

      {/* Filters (manager only) */}
      {isManager && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الموظف</Label>
                <SearchableSelect
                  options={[
                    { value: "", label: "الكل" },
                    ...employees.map((e) => ({
                      value: e.id,
                      label: e.name,
                      sublabel: ROLE_LABELS[e.role],
                    })),
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
                    <span>{dateTo || "اختر تاريخاً"}</span>
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
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reports list */}
      <div className="space-y-2">
        {isManager && (
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" />
            تقارير الموظفين
            {allReports.length > 0 && <Badge variant="secondary">{allReports.length}</Badge>}
          </h2>
        )}
        {!isManager && allReports.length > 0 && (
          <h2 className="text-lg font-semibold">تقاريري السابقة</h2>
        )}

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : allReports.length === 0 ? (
          <div className="rounded-lg border py-12 text-center text-muted-foreground">
            لا توجد تقارير
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {isManager && <TableHead>الموظف</TableHead>}
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الشيفت</TableHead>
                  <TableHead>البيانات</TableHead>
                  {isManager && <TableHead>الدور</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allReports.map((report) => (
                  <TableRow key={report.id} className="align-top">
                    {isManager && (
                      <TableCell className="font-medium whitespace-nowrap">
                        {report.user.name}
                      </TableCell>
                    )}
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
                    {isManager && (
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {ROLE_LABELS[report.user.role]}
                        </Badge>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DailyReportsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <DailyReportsInner />
    </Suspense>
  );
}
