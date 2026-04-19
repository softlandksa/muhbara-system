"use client";

import { useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Plus, Pencil, Trash2, Loader2, CalendarIcon, Target } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmployeeTarget = {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  targetDeliveredOrderCount: number | null;
  targetRevenue: number | null;
  currencyId: string | null;
  notes: string | null;
  user: { id: string; name: string; role: Role; team: { id: string; name: string } | null };
  currency: { id: string; code: string; symbol: string } | null;
};

type LookupUser = { id: string; name: string; role: Role };
type Currency   = { id: string; name: string; code: string; symbol: string };

const COMMISSION_ROLES: Role[] = ["SALES", "SHIPPING", "FOLLOWUP", "SALES_MANAGER", "GENERAL_MANAGER"];

// ─── Form Schema ──────────────────────────────────────────────────────────────

const formSchema = z.object({
  userId:                    z.string().min(1, "اختر الموظف"),
  periodStart:               z.string().min(1, "تاريخ البداية مطلوب"),
  periodEnd:                 z.string().min(1, "تاريخ النهاية مطلوب"),
  targetDeliveredOrderCount: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? null : Number(v),
    z.number().int().min(0).nullable().optional(),
  ),
  targetRevenue: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? null : Number(v),
    z.number().min(0).nullable().optional(),
  ),
  currencyId: z.string().nullable().optional(),
  notes:      z.string().max(500).nullable().optional(),
});

type FormData = {
  userId: string;
  periodStart: string;
  periodEnd: string;
  targetDeliveredOrderCount?: number | null;
  targetRevenue?: number | null;
  currencyId?: string | null;
  notes?: string | null;
};

// ─── Add/Edit Dialog ──────────────────────────────────────────────────────────

function TargetDialog({
  open,
  editing,
  onClose,
  users,
  currencies,
}: {
  open: boolean;
  editing: EmployeeTarget | null;
  onClose: () => void;
  users: LookupUser[];
  currencies: Currency[];
}) {
  const queryClient = useQueryClient();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen,   setEndOpen]   = useState(false);

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues: editing ? {
      userId:                    editing.userId,
      periodStart:               editing.periodStart.slice(0, 10),
      periodEnd:                 editing.periodEnd.slice(0, 10),
      targetDeliveredOrderCount: editing.targetDeliveredOrderCount ?? undefined,
      targetRevenue:             editing.targetRevenue ?? undefined,
      currencyId:                editing.currencyId ?? "",
      notes:                     editing.notes ?? "",
    } : {
      userId: "", periodStart: "", periodEnd: "",
      targetDeliveredOrderCount: undefined, targetRevenue: undefined,
      currencyId: "", notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const url    = editing ? `/api/admin/targets/${editing.id}` : "/api/admin/targets";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          currencyId:                data.currencyId || null,
          targetDeliveredOrderCount: data.targetDeliveredOrderCount ?? null,
          targetRevenue:             data.targetRevenue ?? null,
          notes:                     data.notes || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "فشل الحفظ");
      return json.data;
    },
    onSuccess: () => {
      toast.success(editing ? "تم تحديث التارجت" : "تمت إضافة التارجت");
      reset();
      onClose();
      queryClient.invalidateQueries({ queryKey: ["employee-targets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const periodStart = watch("periodStart");
  const periodEnd   = watch("periodEnd");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل التارجت" : "إضافة تارجت جديد"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">

          {/* Employee */}
          <div className="space-y-1.5">
            <Label>الموظف</Label>
            <SearchableSelect
              options={users.map((u) => ({
                value: u.id,
                label: `${u.name} — ${ROLE_LABELS[u.role] ?? u.role}`,
              }))}
              value={watch("userId") ?? ""}
              onChange={(v) => setValue("userId", v, { shouldValidate: true })}
              placeholder="اختر الموظف"
              error={!!errors.userId}
              disabled={!!editing}
            />
            {errors.userId && <p className="text-xs text-destructive">{errors.userId.message}</p>}
          </div>

          {/* Period */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>من تاريخ</Label>
              <Popover open={startOpen} onOpenChange={setStartOpen}>
                <PopoverTrigger className={cn(
                  "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-sm",
                  !periodStart && "text-muted-foreground",
                  errors.periodStart && "border-destructive",
                )}>
                  <span>{periodStart || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={periodStart ? new Date(periodStart) : undefined}
                    onDayClick={(d) => { setValue("periodStart", format(d, "yyyy-MM-dd"), { shouldValidate: true }); setStartOpen(false); }} />
                </PopoverContent>
              </Popover>
              {errors.periodStart && <p className="text-xs text-destructive">{errors.periodStart.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>إلى تاريخ</Label>
              <Popover open={endOpen} onOpenChange={setEndOpen}>
                <PopoverTrigger className={cn(
                  "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-sm",
                  !periodEnd && "text-muted-foreground",
                  errors.periodEnd && "border-destructive",
                )}>
                  <span>{periodEnd || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={periodEnd ? new Date(periodEnd) : undefined}
                    onDayClick={(d) => { setValue("periodEnd", format(d, "yyyy-MM-dd"), { shouldValidate: true }); setEndOpen(false); }} />
                </PopoverContent>
              </Popover>
              {errors.periodEnd && <p className="text-xs text-destructive">{errors.periodEnd.message}</p>}
            </div>
          </div>

          {/* Targets */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>هدف الطلبات المسلمة</Label>
              <Input
                type="number" min={0}
                {...register("targetDeliveredOrderCount")}
                placeholder="مثال: 50"
              />
            </div>
            <div className="space-y-1.5">
              <Label>هدف الإيرادات (اختياري)</Label>
              <Input
                type="number" min={0} step="0.01"
                {...register("targetRevenue")}
                placeholder="مثال: 10000"
              />
            </div>
          </div>

          {/* Currency (for revenue target) */}
          <div className="space-y-1.5">
            <Label>عملة هدف الإيرادات</Label>
            <SearchableSelect
              options={[
                { value: "", label: "— بدون عملة —" },
                ...currencies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
              ]}
              value={watch("currencyId") ?? ""}
              onChange={(v) => setValue("currencyId", v || null)}
              placeholder="اختر العملة"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea {...register("notes")} placeholder="أي ملاحظات إضافية..." rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              إلغاء
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
              {editing ? "تحديث" : "إضافة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AdminTargetsInner() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const role = session?.user?.role;

  const [addOpen,     setAddOpen]     = useState(false);
  const [editing,     setEditing]     = useState<EmployeeTarget | null>(null);
  const [deleteId,    setDeleteId]    = useState<string | null>(null);

  const { data: targetsData, isLoading } = useQuery<{ data: EmployeeTarget[] }>({
    queryKey: ["employee-targets"],
    queryFn: () => fetch("/api/admin/targets").then((r) => r.json()),
  });

  const { data: usersRaw } = useQuery<{ data: LookupUser[] }>({
    queryKey: ["lookup-users-commission"],
    queryFn: () => fetch("/api/lookup/users").then((r) => r.json()),
  });

  const { data: currData } = useQuery<Currency[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () => fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => r.data ?? []),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/targets/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "فشل الحذف");
    },
    onSuccess: () => {
      toast.success("تم حذف التارجت");
      queryClient.invalidateQueries({ queryKey: ["employee-targets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Filter users to commission-eligible roles only
  const eligibleUsers = (usersRaw?.data ?? []).filter((u) =>
    COMMISSION_ROLES.includes(u.role as Role),
  );

  const currencies = currData ?? [];
  const targets    = targetsData?.data ?? [];

  const canWrite = role === "ADMIN" || role === "GENERAL_MANAGER";

  if (role !== "ADMIN" && role !== "GENERAL_MANAGER") {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">غير مصرح</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6" />
            إدارة التارجت (فترات مرنة)
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            حدد أهداف مرنة بفترات زمنية مخصصة لكل موظف — منفصلة عن التارجت الشهري الكلاسيكي
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 ml-1" />تارجت جديد
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الموظف</TableHead>
              <TableHead>الدور</TableHead>
              <TableHead>الفريق</TableHead>
              <TableHead>الفترة</TableHead>
              <TableHead>هدف الطلبات</TableHead>
              <TableHead>هدف الإيرادات</TableHead>
              <TableHead>ملاحظات</TableHead>
              {canWrite && <TableHead className="w-20"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: canWrite ? 8 : 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : targets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 8 : 7} className="text-center py-12 text-muted-foreground">
                  لا توجد تارجتات — اضغط &quot;تارجت جديد&quot; للبدء
                </TableCell>
              </TableRow>
            ) : targets.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.user.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">
                    {ROLE_LABELS[t.user.role] ?? t.user.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t.user.team?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm font-mono">
                  {format(new Date(t.periodStart), "dd/MM/yyyy", { locale: arSA })}
                  {" — "}
                  {format(new Date(t.periodEnd), "dd/MM/yyyy", { locale: arSA })}
                </TableCell>
                <TableCell>
                  {t.targetDeliveredOrderCount != null
                    ? <span className="font-semibold">{t.targetDeliveredOrderCount} طلب</span>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {t.targetRevenue != null
                    ? <span className="font-semibold">{t.targetRevenue.toLocaleString()} {t.currency?.code ?? ""}</span>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                  {t.notes ?? "—"}
                </TableCell>
                {canWrite && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(t.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TargetDialog
        open={addOpen || !!editing}
        editing={editing}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        users={eligibleUsers}
        currencies={currencies}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="حذف التارجت"
        description="هل أنت متأكد من حذف هذا التارجت؟"
        confirmLabel="حذف"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId, { onSuccess: () => setDeleteId(null) });
        }}
      />
    </div>
  );
}

export default function AdminTargetsPage() {
  return (
    <Suspense fallback={
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    }>
      <AdminTargetsInner />
    </Suspense>
  );
}
