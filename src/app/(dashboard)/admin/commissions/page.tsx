"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import {
  Plus, Trash2, Loader2, Calculator, CalendarIcon,
  ToggleLeft, ToggleRight, Target, Save, X, CheckCircle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type CommissionRule = {
  id: string;
  name: string;
  roleType: string;
  minOrders: number;
  maxOrders: number | null;
  commissionAmount: number;
  commissionType: "FIXED" | "PERCENTAGE";
  isActive: boolean;
  currency: { id: string; code: string; symbol: string };
};

type Currency = { id: string; name: string; code: string; symbol: string };

type TargetEmployee = {
  id: string;
  name: string;
  role: Role;
  team: { id: string; name: string } | null;
  targetId: string | null;
  targetOrders: number | null;
};

// ─── Rule form schema ─────────────────────────────────────────────────────────

const COMMISSION_ROLES = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"] as const;
type CommissionRoleType = (typeof COMMISSION_ROLES)[number];

const COMMISSION_ROLE_LABELS: Record<CommissionRoleType, string> = {
  SALES:           "موظف مبيعات (طلباته هو)",
  SHIPPING:        "موظف شحن (الطلبات التي شحنها)",
  FOLLOWUP:        "موظف متابعة (الطلبات التي تابعها)",
  SALES_MANAGER:   "مدير فريق (كل طلبات الفريق)",
  GENERAL_MANAGER: "مدير عام (جميع الطلبات)",
};

const ruleSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  roleType: z.enum(COMMISSION_ROLES),
  minOrders: z.number().int().min(0),
  maxOrders: z.number().int().min(0).nullable().optional(),
  commissionAmount: z.number().min(0),
  commissionType: z.enum(["FIXED", "PERCENTAGE"]),
  currencyId: z.string().min(1, "العملة مطلوبة"),
});
type RuleFormData = z.infer<typeof ruleSchema>;

// ─── Add Rule Dialog ──────────────────────────────────────────────────────────

function AddRuleDialog({
  open, onClose, currencies,
}: {
  open: boolean; onClose: () => void; currencies: Currency[];
}) {
  const queryClient = useQueryClient();
  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<RuleFormData>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      roleType: "SALES" as CommissionRoleType, commissionType: "FIXED", minOrders: 1, commissionAmount: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: RuleFormData) => {
      const payload = {
        ...data,
        // Ensure NaN (from empty number inputs) becomes null before JSON serialisation
        maxOrders: typeof data.maxOrders === "number" && isNaN(data.maxOrders)
          ? null
          : (data.maxOrders ?? null),
        minOrders: typeof data.minOrders === "number" && isNaN(data.minOrders)
          ? 0
          : data.minOrders,
        commissionAmount: typeof data.commissionAmount === "number" && isNaN(data.commissionAmount)
          ? 0
          : data.commissionAmount,
      };
      const res = await fetch("/api/commissions/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let json: { error?: string; data?: CommissionRule } = {};
      try { json = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) throw new Error(json.error ?? "فشل إضافة الشريحة");
      return json.data;
    },
    onSuccess: () => {
      toast.success("تمت إضافة الشريحة بنجاح");
      reset();
      onClose();
      queryClient.invalidateQueries({ queryKey: ["commission-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commissionType = watch("commissionType");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة شريحة عمولة</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>اسم الشريحة</Label>
            <Input
              {...register("name")}
              placeholder="مثال: شريحة الموظفين — المستوى الأول"
              className={cn(errors.name && "border-destructive")}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>نوع الموظف</Label>
              <Select
                value={watch("roleType")}
                onValueChange={(v) => setValue("roleType", v as CommissionRoleType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMISSION_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{COMMISSION_ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>نوع العمولة</Label>
              <Select
                value={watch("commissionType")}
                onValueChange={(v) => setValue("commissionType", v as "FIXED" | "PERCENTAGE")}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">مبلغ ثابت</SelectItem>
                  <SelectItem value="PERCENTAGE">نسبة مئوية من المبيعات</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الحد الأدنى للطلبات المسلمة</Label>
              <Input
                type="number"
                min={0}
                {...register("minOrders", { valueAsNumber: true })}
                className={cn(errors.minOrders && "border-destructive")}
              />
              {errors.minOrders && <p className="text-xs text-destructive">{errors.minOrders.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>الحد الأقصى (اختياري)</Label>
              <Input
                type="number"
                min={0}
                {...register("maxOrders", { valueAsNumber: true })}
                placeholder="غير محدود"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                {commissionType === "PERCENTAGE" ? "النسبة %" : "المبلغ"}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                {...register("commissionAmount", { valueAsNumber: true })}
                className={cn(errors.commissionAmount && "border-destructive")}
              />
              {commissionType === "PERCENTAGE" && (
                <p className="text-xs text-muted-foreground">
                  نسبة من إجمالي مبيعات الموظف (المسلمة) في الفترة
                </p>
              )}
              {errors.commissionAmount && <p className="text-xs text-destructive">{errors.commissionAmount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>العملة</Label>
              <SearchableSelect
                options={currencies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
                value={watch("currencyId") ?? ""}
                onChange={(v) => setValue("currencyId", v, { shouldValidate: true })}
                placeholder="اختر العملة"
                error={!!errors.currencyId}
              />
              {errors.currencyId && (
                <p className="text-xs text-destructive">{errors.currencyId.message}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            لا يجوز تداخل نطاقات الطلبات لنفس الدور والعملة. سيتم رفض الشريحة إذا تداخلت مع شريحة نشطة.
          </p>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} disabled={mutation.isPending}>
              إلغاء
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
              حفظ الشريحة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Apply Tiers Dialog ───────────────────────────────────────────────────────

function ApplyTiersDialog({
  open,
  onClose,
  activeRules,
}: {
  open: boolean;
  onClose: () => void;
  activeRules: CommissionRule[];
}) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleApply = async () => {
    if (!periodStart || !periodEnd) { toast.error("اختر الفترة الزمنية كاملة"); return; }
    if (periodStart > periodEnd) { toast.error("تاريخ البداية يجب أن يكون قبل تاريخ النهاية"); return; }
    if (activeRules.length === 0) { toast.error("لا توجد شرائح نشطة — أضف شرائح أولاً"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/commissions/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      let json: { error?: string; data?: { calculated: number } } = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) { toast.error(json.error ?? "فشل تطبيق الشرائح"); return; }
      toast.success(`تم تطبيق الشرائح على ${json.data?.calculated ?? 0} موظف في الفترة المحددة`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setPeriodStart("");
    setPeriodEnd("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            تطبيق الشرائح على فترة
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Period pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>من تاريخ</Label>
              <Popover open={startOpen} onOpenChange={setStartOpen}>
                <PopoverTrigger className={cn(
                  "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm",
                  !periodStart && "text-muted-foreground"
                )}>
                  <span>{periodStart || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={periodStart ? new Date(periodStart) : undefined}
                    onDayClick={(d) => { setPeriodStart(format(d, "yyyy-MM-dd")); setStartOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label>إلى تاريخ</Label>
              <Popover open={endOpen} onOpenChange={setEndOpen}>
                <PopoverTrigger className={cn(
                  "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm",
                  !periodEnd && "text-muted-foreground"
                )}>
                  <span>{periodEnd || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={periodEnd ? new Date(periodEnd) : undefined}
                    onDayClick={(d) => { setPeriodEnd(format(d, "yyyy-MM-dd")); setEndOpen(false); }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Active tiers summary */}
          <div className="rounded-lg border bg-muted/30 overflow-hidden">
            <div className="px-3 py-2 border-b bg-muted/50">
              <p className="text-xs font-medium text-muted-foreground">
                الشرائح النشطة التي ستُطبَّق ({activeRules.length})
              </p>
            </div>
            {activeRules.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                لا توجد شرائح نشطة — أضف شرائح من تبويب &quot;شرائح العمولات&quot;
              </p>
            ) : (
              <div className="divide-y max-h-48 overflow-y-auto">
                {activeRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <span className="font-medium">{rule.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">
                        {COMMISSION_ROLE_LABELS[rule.roleType as CommissionRoleType]?.split(" ")[0] ?? rule.roleType}
                      </Badge>
                      <span className="font-mono">
                        {rule.minOrders}–{rule.maxOrders ?? "∞"} طلب
                      </span>
                      <span className="font-semibold text-foreground">
                        {rule.commissionAmount}
                        {rule.commissionType === "PERCENTAGE" ? "%" : ` ${rule.currency.code}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded p-2">
            سيتم حساب عدد الطلبات المسلمة لكل موظف خلال الفترة المحددة فقط وتطبيق الشريحة المناسبة تلقائياً. لا يرتبط بالتارجت الشهري.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button
            onClick={handleApply}
            disabled={loading || !periodStart || !periodEnd || activeRules.length === 0}
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
              : <Calculator className="h-4 w-4 ml-1" />}
            تطبيق الشرائح على الفترة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Targets Tab ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function TargetsTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [editedTargets, setEditedTargets] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery<{ data: TargetEmployee[] }>({
    queryKey: ["admin-targets", year, month],
    queryFn: () =>
      fetch(`/api/targets?year=${year}&month=${month}`)
        .then((r) => r.json()),
  });

  const employees = data?.data ?? [];

  // Sync edit state when data loads / month changes
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const emp of employees) {
      initial[emp.id] = emp.targetOrders != null ? String(emp.targetOrders) : "";
    }
    setEditedTargets(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSave = useCallback(
    async (emp: TargetEmployee) => {
      const raw = editedTargets[emp.id] ?? "";
      const val = parseInt(raw);

      if (raw === "" && emp.targetId === null) return;

      if (raw === "" && emp.targetId !== null) {
        setSavingIds((s) => new Set(s).add(emp.id));
        try {
          const res = await fetch(`/api/targets/${emp.targetId}`, { method: "DELETE" });
          let j: { error?: string } = {};
          try { j = await res.json(); } catch { /* */ }
          if (!res.ok) { toast.error(j.error ?? "فشل الحذف"); return; }
          toast.success(`تم حذف تارجت ${emp.name}`);
          refetch();
        } finally {
          setSavingIds((s) => { const n = new Set(s); n.delete(emp.id); return n; });
        }
        return;
      }

      if (isNaN(val) || val < 1) { toast.error("التارجت يجب أن يكون رقماً أكبر من صفر"); return; }

      setSavingIds((s) => new Set(s).add(emp.id));
      try {
        const res = await fetch("/api/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: emp.id, year, month, targetOrders: val }),
        });
        let json: { error?: string } = {};
        try { json = await res.json(); } catch { /* */ }
        if (!res.ok) { toast.error(json.error ?? "فشل الحفظ"); return; }
        toast.success(`تم حفظ تارجت ${emp.name}`);
        refetch();
      } finally {
        setSavingIds((s) => { const n = new Set(s); n.delete(emp.id); return n; });
      }
    },
    [editedTargets, year, month, refetch],
  );

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <div className="space-y-4">
      {/* Month / Year picker */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">الشهر</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">السنة</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground self-end pb-1">
              تارجت {MONTH_NAMES[month - 1]} {year} — لكل موظف على حدة (KPI فقط، لا يؤثر على العمولة)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Targets table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>الدور</TableHead>
              <TableHead>الفريق</TableHead>
              <TableHead className="w-44">التارجت الشهري (طلبات)</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  لا يوجد موظفون نشطون
                </TableCell>
              </TableRow>
            ) : employees.map((emp) => {
              const isSaving = savingIds.has(emp.id);
              const currentVal = editedTargets[emp.id] ?? "";
              const originalVal = emp.targetOrders != null ? String(emp.targetOrders) : "";
              const isDirty = currentVal !== originalVal;

              return (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {ROLE_LABELS[emp.role] ?? emp.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {emp.team?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      value={currentVal}
                      placeholder="لم يُحدد"
                      onChange={(e) =>
                        setEditedTargets((prev) => ({ ...prev, [emp.id]: e.target.value }))
                      }
                      onKeyDown={(e) => { if (e.key === "Enter") handleSave(emp); }}
                      className={cn("w-36", isDirty && "border-primary")}
                      disabled={isSaving}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={isDirty ? "default" : "outline"}
                        onClick={() => handleSave(emp)}
                        disabled={isSaving || !isDirty}
                        className="gap-1"
                      >
                        {isSaving
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Save className="h-3.5 w-3.5" />}
                        حفظ
                      </Button>
                      {currentVal !== "" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setEditedTargets((prev) => ({ ...prev, [emp.id]: "" }))
                          }
                          disabled={isSaving}
                          title="مسح"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommissionsAdminPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"tiers" | "targets">("tiers");
  const [addOpen, setAddOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rulesData } = useQuery<{ data: CommissionRule[] }>({
    queryKey: ["commission-rules"],
    queryFn: () => fetch("/api/commissions/rules").then((r) => r.json()),
    enabled: session?.user?.role === "ADMIN",
  });

  const { data: currData } = useQuery<Currency[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () =>
      fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => (r.data ?? []) as Currency[]),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/commissions/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      let json: { error?: string; data?: CommissionRule } = {};
      try { json = await res.json(); } catch { /* */ }
      if (!res.ok) throw new Error(json.error ?? "فشل التحديث");
      return json.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["commission-rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/commissions/rules/${id}`, { method: "DELETE" });
      let json: { error?: string } = {};
      try { json = await res.json(); } catch { /* */ }
      if (!res.ok) throw new Error(json.error ?? "فشل الحذف");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission-rules"] });
      toast.success("تم حذف الشريحة");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rules = rulesData?.data ?? [];
  const activeRules = rules.filter((r) => r.isActive);
  const currencies: Currency[] = currData ?? [];

  if (session?.user?.role !== "ADMIN") {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">إدارة العمولات والتارجت</h1>
        {activeTab === "tiers" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCalcOpen(true)}>
              <Calculator className="h-4 w-4 ml-1" />
              تطبيق الشرائح
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 ml-1" />شريحة جديدة
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b">
        {[
          { key: "tiers" as const, label: "شرائح العمولات", icon: null },
          { key: "targets" as const, label: "التارجت الشهري", icon: <Target className="h-4 w-4" /> },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Commission Tiers Tab ── */}
      {activeTab === "tiers" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم الشريحة</TableHead>
                  <TableHead>الدور</TableHead>
                  <TableHead>نطاق الطلبات المسلمة</TableHead>
                  <TableHead>العمولة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>العملة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      لا توجد شرائح عمولات بعد — اضغط &quot;شريحة جديدة&quot; للبدء
                    </TableCell>
                  </TableRow>
                ) : (
                  rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {COMMISSION_ROLE_LABELS[rule.roleType as CommissionRoleType] ?? rule.roleType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {rule.minOrders} — {rule.maxOrders ?? "∞"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {rule.commissionAmount}
                        {rule.commissionType === "PERCENTAGE" ? "%" : ""}
                      </TableCell>
                      <TableCell>
                        {rule.commissionType === "FIXED" ? "مبلغ ثابت" : "% من المبيعات"}
                      </TableCell>
                      <TableCell>{rule.currency.code}</TableCell>
                      <TableCell>
                        <button
                          onClick={() =>
                            toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })
                          }
                          disabled={toggleMutation.isPending}
                          title={rule.isActive ? "تعطيل" : "تفعيل"}
                        >
                          {rule.isActive
                            ? <ToggleRight className="h-5 w-5 text-green-500" />
                            : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(rule.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Monthly Targets Tab ── */}
      {activeTab === "targets" && <TargetsTab />}

      {/* Dialogs */}
      <AddRuleDialog open={addOpen} onClose={() => setAddOpen(false)} currencies={currencies} />
      <ApplyTiersDialog
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        activeRules={activeRules}
      />
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="حذف شريحة العمولة"
        description="هل أنت متأكد من حذف هذه الشريحة؟ لا يمكن التراجع عن هذا الإجراء."
        confirmLabel="حذف"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) });
        }}
      />
    </div>
  );
}
