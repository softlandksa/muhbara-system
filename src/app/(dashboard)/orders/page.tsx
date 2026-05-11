"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatOrderDate } from "@/lib/date-format";
import {
  Plus, Download, Upload, Loader2,
  SlidersHorizontal, X, CalendarIcon, FileDown, AlertCircle, CheckCircle2, Trash2,
  RefreshCw, ListChecks, ChevronDown,
} from "lucide-react";
import { PaginationArrows } from "@/components/shared/PaginationArrows";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AppLoadingOverlay } from "@/components/shared/AppLoadingOverlay";
import { GoogleSheetSyncButton } from "@/components/shared/GoogleSheetSyncButton";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const EXPORT_WARN_THRESHOLD = 5_000;
const PREVIEW_HEADERS = ["اسم العميل", "الجوال", "العنوان", "الدولة", "العملة", "طريقة الدفع", "المنتج", "الكمية", "السعر"];

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusItem = { id: string; name: string; color: string };

type OrderRow = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  phone: string;
  status: StatusItem;
  totalAmount: number;
  isRepeatCustomer?: boolean;
  country: { id: string; name: string };
  currency: { id: string; code: string; symbol: string };
  paymentMethod: { id: string; name: string };
  createdBy: { id: string; name: string };
  items: { product: { id: string; name: string }; quantity: number }[];
};

type PaginatedOrders = {
  data: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ImportResult = {
  created: number;
  repeatCustomers: number;
  errors: { row: number; error: string }[];
};

type FiltersApplyPayload = {
  statuses: string[];
  countries: string[];
  employees: string[];
  dateFrom: string;
  dateTo: string;
};

// ─── Import Dialog Error Boundary ─────────────────────────────────────────────

class DialogErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  override componentDidCatch(err: Error) {
    console.error("[ImportDialog] render error:", err);
    setTimeout(() => {
      toast.error("حدث خطأ أثناء تحميل نافذة الاستيراد — يرجى المحاولة مرة أخرى");
      this.props.onError();
    }, 0);
  }
  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── Import Dialog ────────────────────────────────────────────────────────────

function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  type Step = "upload" | "preview" | "result";
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [dupPhones, setDupPhones] = useState<Record<string, { count: number; orderNumbers: string[] }>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreviewRows([]);
    setDupPhones({});
    setResult(null);
    setLoading(false);
  };

  const { rowFlags, inFilePhoneDups, existingPhoneDups, inFileNameDups } = useMemo(() => {
    const normPhone = (r: Record<string, unknown>) => String(r["الجوال"] ?? "").trim();
    const normName  = (r: Record<string, unknown>) => String(r["اسم العميل"] ?? "").trim().toLowerCase();

    const phoneCount = new Map<string, number>();
    const nameCount  = new Map<string, number>();
    for (const row of previewRows) {
      const p = normPhone(row); if (p) phoneCount.set(p, (phoneCount.get(p) ?? 0) + 1);
      const n = normName(row);  if (n)  nameCount.set(n,  (nameCount.get(n)  ?? 0) + 1);
    }

    const flags = previewRows.map((row) => {
      const p = normPhone(row);
      const n = normName(row);
      return {
        duplicatePhone: (p ? (phoneCount.get(p) ?? 0) > 1 : false) || (p ? !!dupPhones[p] : false),
        duplicateName:  n ? (nameCount.get(n) ?? 0) > 1 : false,
      };
    });

    return {
      rowFlags: flags,
      inFilePhoneDups: [...phoneCount.entries()].filter(([, c]) => c > 1).length,
      existingPhoneDups: Object.keys(dupPhones).length,
      inFileNameDups: [...nameCount.entries()].filter(([, c]) => c > 1).length,
    };
  }, [previewRows, dupPhones]);

  const handleClose = () => { reset(); onClose(); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      toast.error("الملف غير مدعوم — استخدم .xlsx أو .xls فقط");
      e.target.value = "";
      return;
    }

    setFile(f);

    let rows: Record<string, unknown>[] = [];
    try {
      const buf = await f.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });

      if (wb.SheetNames.length === 0) {
        toast.error("الملف لا يحتوي على أوراق عمل");
        e.target.value = "";
        return;
      }

      const REQUIRED = ["اسم العميل", "الجوال", "العنوان", "الدولة", "العملة", "طريقة الدفع", "المنتج", "الكمية", "السعر"];
      const norm = (v: unknown) => String(v ?? "").replace(/^﻿/, "").replace(/\s+/g, " ").trim();

      let sheetName = wb.SheetNames.find((n) => n === "الطلبات") ?? wb.SheetNames[0];
      if (sheetName !== "الطلبات") {
        let best = 0;
        for (const name of wb.SheetNames) {
          const s = wb.Sheets[name];
          if (!s) continue;
          const firstRow = (XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1 })[0] ?? []).map(norm);
          const score = REQUIRED.filter((h) => firstRow.includes(h)).length;
          if (score > best) { best = score; sheetName = name; }
        }
      }

      const ws = wb.Sheets[sheetName];
      if (!ws) { toast.error("الملف لا يحتوي على أوراق عمل"); e.target.value = ""; return; }

      const rawAll = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      let headerIdx = 0;
      let bestScore = 0;
      for (let i = 0; i < Math.min(10, rawAll.length); i++) {
        const cells = (rawAll[i] as unknown[]).map(norm);
        const score = REQUIRED.filter((h) => cells.includes(h)).length;
        if (score > bestScore) { bestScore = score; headerIdx = i; }
      }

      const headerCells = (rawAll[headerIdx] as unknown[]).map(norm);
      const colMap: Record<string, number> = {};
      headerCells.forEach((h, idx) => { if (h) colMap[h] = idx; });

      const HINT_RE = /\(مطلوب\)|مثال:|اختر من القائمة|رقم صحيح|سعر الوحدة/u;

      rows = rawAll
        .slice(headerIdx + 1)
        .map((rawRow) => {
          const obj: Record<string, unknown> = {};
          for (const [key, idx] of Object.entries(colMap)) {
            obj[key] = (rawRow as unknown[])[idx] ?? "";
          }
          return obj;
        })
        .filter((obj) =>
          Object.values(obj).some((v) => String(v ?? "").trim() !== "") &&
          !Object.values(obj).some((v) => HINT_RE.test(String(v ?? "")))
        );
    } catch (err) {
      console.error("[import preview] XLSX parse error:", err);
      toast.error("تعذّر قراءة الملف — تأكد أنه ملف Excel صحيح (.xlsx / .xls)");
      e.target.value = "";
      return;
    }

    if (rows.length === 0) {
      toast.error("الملف لا يحتوي على صفوف بيانات");
      e.target.value = "";
      return;
    }

    setPreviewRows(rows);
    setStep("preview");
    e.target.value = "";

    const phones = rows
      .map((r) => String(r["الجوال"] ?? "").trim())
      .filter(Boolean);
    if (phones.length > 0) {
      try {
        const res = await fetch("/api/orders/check-duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phones }),
        });
        if (res.ok) {
          const json = await res.json();
          setDupPhones(json.data ?? {});
        }
      } catch {
        // non-critical
      }
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/orders/import", { method: "POST", body: formData });
      let json: { data?: ImportResult; error?: string } = {};
      try {
        json = await res.json();
      } catch {
        toast.error("استجابة غير متوقعة من الخادم");
        return;
      }
      if (!res.ok) {
        toast.error(json.error ?? "فشل الاستيراد");
        return;
      }
      if (json.data) {
        const { created, errors: importErrors } = json.data;
        if (created > 0) onDone();
        if (importErrors.length === 0) {
          toast.success(`تم استيراد ${created} طلب بنجاح`);
          handleClose();
        } else {
          setResult(json.data);
          setStep("result");
          if (created > 0) {
            toast.success(`تم استيراد ${created} طلب (${importErrors.length} صف به أخطاء)`);
          }
        }
      }
    } catch (err) {
      console.error("[import] fetch error:", err);
      toast.error("تعذّر الاتصال بالخادم — تحقق من الاتصال وأعد المحاولة");
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateDownload = async () => {
    try {
      const res = await fetch("/api/orders/template");
      if (!res.ok) { toast.error("فشل تحميل النموذج"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "نموذج_الطلبات.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("فشل تحميل النموذج");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-2xl flex flex-col max-h-[90dvh]">
        <DialogErrorBoundary onError={handleClose}>
          <AppLoadingOverlay open={loading} mode="inline" message="جاري استيراد الطلبات..." />

          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              استيراد الطلبات من Excel
            </DialogTitle>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-1">

            {step === "upload" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-dashed p-4 bg-muted/30">
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">رفع ملف Excel</p>
                    <p>الامتدادات المقبولة: .xlsx, .xls</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 ml-1.5" />
                    اختر ملفاً
                  </Button>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm">
                  <FileDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground flex-1">لا تعرف الأعمدة المطلوبة؟</span>
                  <button
                    type="button"
                    className="text-primary hover:underline text-sm font-medium"
                    onClick={handleTemplateDownload}
                  >
                    تحميل نموذج فارغ
                  </button>
                </div>

                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="font-medium">الأعمدة المطلوبة في الملف:</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {PREVIEW_HEADERS.map((h) => (
                      <Badge key={h} variant="secondary" className="text-xs">{h}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === "preview" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    تم العثور على{" "}
                    <span className="font-medium text-foreground">{previewRows.length}</span> صف
                  </p>
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => { setStep("upload"); setFile(null); setPreviewRows([]); }}
                  >
                    تغيير الملف
                  </button>
                </div>

                {(inFilePhoneDups > 0 || existingPhoneDups > 0 || inFileNameDups > 0) && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 leading-snug">
                      {(inFilePhoneDups > 0 || existingPhoneDups > 0) && (
                        <p>
                          {inFilePhoneDups > 0 && (
                            <><strong>{inFilePhoneDups}</strong> جوال مكرر داخل الملف{existingPhoneDups > 0 ? " · " : ""}</>
                          )}
                          {existingPhoneDups > 0 && (
                            <><strong>{existingPhoneDups}</strong> جوال موجود مسبقاً في النظام</>
                          )}
                          {" — سيتم تمييز الطلبات كعملاء مكررين عند الاستيراد"}
                        </p>
                      )}
                      {inFileNameDups > 0 && (
                        <p><strong>{inFileNameDups}</strong> اسم عميل مكرر داخل الملف</p>
                      )}
                    </div>
                  </div>
                )}

                {(inFilePhoneDups > 0 || existingPhoneDups > 0 || inFileNameDups > 0) && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground select-none" aria-hidden="true">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm bg-amber-100 ring-1 ring-amber-400 shrink-0" />
                      الجوال المكرر
                    </span>
                    <span className="text-muted-foreground/40">|</span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm bg-rose-100 ring-1 ring-rose-400 shrink-0" />
                      الاسم المكرر
                    </span>
                  </div>
                )}

                <div className="max-h-52 overflow-auto rounded-lg border text-xs" dir="rtl">
                  <table className="min-w-max w-full border-collapse">
                    <thead className="bg-muted/40 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-right font-semibold whitespace-nowrap border-b w-8">#</th>
                        {PREVIEW_HEADERS.map((h) => (
                          <th key={h} className="px-3 py-2 text-right font-semibold whitespace-nowrap border-b">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 50).map((row, i) => {
                        const flags = rowFlags[i] ?? { duplicatePhone: false, duplicateName: false };
                        const hasAnyDup = flags.duplicatePhone || flags.duplicateName;
                        return (
                          <tr
                            key={i}
                            className={cn(
                              "border-b last:border-0 hover:bg-muted/20",
                              hasAnyDup && "border-r-2 border-r-amber-400"
                            )}
                          >
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{i + 1}</td>
                            {PREVIEW_HEADERS.map((h) => {
                              const isPhoneCol = h === "الجوال";
                              const isNameCol  = h === "اسم العميل";
                              const showPhone  = isPhoneCol && flags.duplicatePhone;
                              const showName   = isNameCol  && flags.duplicateName;
                              return (
                                <td
                                  key={h}
                                  className={cn(
                                    "px-3 py-1.5 text-right whitespace-nowrap",
                                    showPhone && "bg-amber-100 ring-1 ring-inset ring-amber-400",
                                    showName  && "bg-rose-100  ring-1 ring-inset ring-rose-400"
                                  )}
                                >
                                  {showPhone || showName ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span>{String(row[h] ?? "")}</span>
                                      <span
                                        className={cn(
                                          "inline-flex rounded-full px-1 py-0.5 text-[9px] font-semibold border",
                                          showPhone
                                            ? "bg-amber-50 text-amber-800 border-amber-400"
                                            : "bg-rose-50  text-rose-800  border-rose-400"
                                        )}
                                        aria-label="مكرر"
                                      >
                                        مكرر
                                      </span>
                                    </span>
                                  ) : (
                                    String(row[h] ?? "")
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {previewRows.length > 50 && (
                        <tr>
                          <td
                            colSpan={PREVIEW_HEADERS.length + 1}
                            className="px-3 py-2 text-center text-muted-foreground"
                          >
                            ... و {previewRows.length - 50} صف آخر
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === "result" && result && (
              <div className="space-y-4">
                {result.created > 0 && (
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <div>
                      <p className="font-medium text-green-800">تم إنشاء {result.created} طلب</p>
                      {result.repeatCustomers > 0 && (
                        <p className="text-sm text-orange-700 mt-0.5">
                          منهم {result.repeatCustomers} طلب لعملاء مكررين
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {result.errors.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      {result.errors.length} صف يحتوي على أخطاء
                    </div>
                    <div className="max-h-48 overflow-auto rounded-lg border text-xs">
                      <table className="w-full border-collapse">
                        <thead className="bg-muted/40 sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-right font-semibold border-b w-16">الصف</th>
                            <th className="px-3 py-2 text-right font-semibold border-b">الخطأ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.errors.map((e, idx) => (
                            <tr key={idx} className="border-b last:border-0">
                              <td className="px-3 py-1.5 text-right font-medium">{e.row}</td>
                              <td className="px-3 py-1.5 text-right text-destructive break-words">{e.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {result.created === 0 && result.errors.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">لا توجد صفوف للاستيراد</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 shrink-0">
            <Button type="button" variant="outline" onClick={handleClose}>إغلاق</Button>
            {step === "preview" && (
              <Button
                type="button"
                onClick={handleImport}
                disabled={loading || previewRows.length === 0}
              >
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                  : <Upload className="h-4 w-4 ml-1" />}
                استيراد {previewRows.length} طلب
              </Button>
            )}
          </DialogFooter>
        </DialogErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Status Dialog ───────────────────────────────────────────────────────

function BulkStatusDialog({
  open,
  onClose,
  count,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  onConfirm: (statusId: string) => Promise<void>;
}) {
  const [statusId, setStatusId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const statuses = statusesData?.data ?? [];

  const handleClose = () => { setStatusId(""); onClose(); };

  const handleSubmit = async () => {
    if (!statusId) return;
    setLoading(true);
    try {
      await onConfirm(statusId);
      setStatusId("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تغيير حالة {count.toLocaleString("ar")} طلب</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>الحالة الجديدة</Label>
          <SearchableSelect
            options={statuses.map((s) => ({ value: s.id, label: s.name }))}
            value={statusId}
            onChange={setStatusId}
            placeholder="اختر الحالة"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={!statusId || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({
  label,
  color,
  onRemove,
}: {
  label: string;
  color?: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full border text-xs font-medium",
        !color && "bg-primary/10 text-primary border-primary/25"
      )}
      style={
        color
          ? { backgroundColor: color + "18", color, borderColor: color + "55" }
          : undefined
      }
    >
      {color && (
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      )}
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="hover:opacity-70 transition-opacity shrink-0"
        aria-label="إزالة الفلتر"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Multi-Check Section (inside FiltersModal) ─────────────────────────────────

function MultiCheckSection({
  title,
  items,
  selected,
  onToggle,
  onToggleAll,
  searchPlaceholder,
  selectedLabel,
}: {
  title: string;
  items: { value: string; label: string; color?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onToggleAll: (wasAllSelected: boolean) => void;
  searchPlaceholder: string;
  selectedLabel?: (count: number) => string;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      search.trim()
        ? items.filter((i) =>
            i.label.toLowerCase().includes(search.toLowerCase())
          )
        : items,
    [items, search]
  );

  const allSelected = items.length > 0 && items.every((i) => selected.includes(i.value));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {selected.length > 0 && (
          <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            {selectedLabel ? selectedLabel(selected.length) : `${selected.length} محدد`}
          </span>
        )}
      </div>
      <div className="border rounded-xl overflow-hidden shadow-sm">
        <div className="p-2 border-b bg-muted/30">
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/60"
            dir="rtl"
          />
        </div>
        <div className="max-h-44 overflow-y-auto p-1.5 space-y-0.5">
          {items.length > 0 && (
            <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted cursor-pointer select-none group">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => onToggleAll(allSelected)}
                className="shrink-0"
              />
              <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground">
                تحديد الكل
              </span>
            </label>
          )}
          {filtered.length === 0 && (
            <p className="text-center py-3 text-sm text-muted-foreground">لا توجد نتائج</p>
          )}
          {filtered.map((item) => (
            <label
              key={item.value}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted cursor-pointer select-none group"
            >
              <Checkbox
                checked={selected.includes(item.value)}
                onCheckedChange={() => onToggle(item.value)}
                className="shrink-0"
              />
              <span className="flex items-center gap-2 text-sm flex-1 min-w-0">
                {item.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="truncate">{item.label}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Filters Modal ─────────────────────────────────────────────────────────────

function FiltersModal({
  open,
  onClose,
  statuses,
  countries,
  employees,
  canFilterByEmployee,
  canFilterByCountry,
  currentStatuses,
  currentCountries,
  currentEmployees,
  currentDateFrom,
  currentDateTo,
  onApply,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  statuses: StatusItem[];
  countries: { id: string; name: string }[];
  employees: { id: string; name: string }[];
  canFilterByEmployee: boolean;
  canFilterByCountry: boolean;
  currentStatuses: string[];
  currentCountries: string[];
  currentEmployees: string[];
  currentDateFrom: string;
  currentDateTo: string;
  onApply: (payload: FiltersApplyPayload) => void;
  onClear: () => void;
}) {
  const [tempStatuses, setTempStatuses] = useState(currentStatuses);
  const [tempCountries, setTempCountries] = useState(currentCountries);
  const [tempEmployees, setTempEmployees] = useState(currentEmployees);
  const [tempDateFrom, setTempDateFrom] = useState(currentDateFrom);
  const [tempDateTo, setTempDateTo] = useState(currentDateTo);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setTempStatuses(currentStatuses);
      setTempCountries(currentCountries);
      setTempEmployees(currentEmployees);
      setTempDateFrom(currentDateFrom);
      setTempDateTo(currentDateTo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleStatus = (id: string) =>
    setTempStatuses((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleCountry = (id: string) =>
    setTempCountries((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleEmployee = (id: string) =>
    setTempEmployees((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const totalSelected =
    tempStatuses.length +
    tempCountries.length +
    tempEmployees.length +
    (tempDateFrom ? 1 : 0) +
    (tempDateTo ? 1 : 0);

  const handleApply = () => {
    onApply({
      statuses: tempStatuses,
      countries: tempCountries,
      employees: tempEmployees,
      dateFrom: tempDateFrom,
      dateTo: tempDateTo,
    });
  };

  const handleClear = () => {
    setTempStatuses([]);
    setTempCountries([]);
    setTempEmployees([]);
    setTempDateFrom("");
    setTempDateTo("");
    onClear();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg flex flex-col max-h-[90dvh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            الفلاتر
            {totalSelected > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5">
                {totalSelected}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 py-2 px-1">
          {/* Shipping Status */}
          <MultiCheckSection
            title="حالة الشحن"
            items={statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
            selected={tempStatuses}
            onToggle={toggleStatus}
            onToggleAll={(allSelected) =>
              setTempStatuses(allSelected ? [] : statuses.map((s) => s.id))
            }
            searchPlaceholder="ابحث عن حالة..."
            selectedLabel={(n) => `${n} حالة محددة`}
          />

          {/* Country */}
          {canFilterByCountry && (
            <MultiCheckSection
              title="الدولة"
              items={countries.map((c) => ({ value: c.id, label: c.name }))}
              selected={tempCountries}
              onToggle={toggleCountry}
              onToggleAll={(allSelected) =>
                setTempCountries(allSelected ? [] : countries.map((c) => c.id))
              }
              searchPlaceholder="ابحث عن دولة..."
              selectedLabel={(n) => `${n === 1 ? "دولة واحدة" : n + " دول"} محددة`}
            />
          )}

          {/* Employee */}
          {canFilterByEmployee && (
            <MultiCheckSection
              title="الموظف"
              items={employees.map((e) => ({ value: e.id, label: e.name }))}
              selected={tempEmployees}
              onToggle={toggleEmployee}
              onToggleAll={(allSelected) =>
                setTempEmployees(allSelected ? [] : employees.map((e) => e.id))
              }
              searchPlaceholder="ابحث عن موظف..."
              selectedLabel={(n) => `${n} موظف محدد`}
            />
          )}

          {/* Date Range */}
          <div className="space-y-2">
            <span className="text-sm font-semibold text-foreground">نطاق التاريخ</span>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">من تاريخ</Label>
                <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                  <PopoverTrigger
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors hover:bg-muted/30",
                      tempDateFrom ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <span>{tempDateFrom || "اختر تاريخاً"}</span>
                    <CalendarIcon className="h-4 w-4 opacity-40" />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={tempDateFrom ? new Date(tempDateFrom) : undefined}
                      onDayClick={(d) => {
                        setTempDateFrom(format(d, "yyyy-MM-dd"));
                        setDateFromOpen(false);
                      }}
                    />
                    {tempDateFrom && (
                      <div className="p-2 border-t">
                        <button
                          type="button"
                          className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
                          onClick={() => { setTempDateFrom(""); setDateFromOpen(false); }}
                        >
                          مسح التاريخ
                        </button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
                <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                  <PopoverTrigger
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors hover:bg-muted/30",
                      tempDateTo ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <span>{tempDateTo || "اختر تاريخاً"}</span>
                    <CalendarIcon className="h-4 w-4 opacity-40" />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={tempDateTo ? new Date(tempDateTo) : undefined}
                      onDayClick={(d) => {
                        setTempDateTo(format(d, "yyyy-MM-dd"));
                        setDateToOpen(false);
                      }}
                    />
                    {tempDateTo && (
                      <div className="p-2 border-t">
                        <button
                          type="button"
                          className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
                          onClick={() => { setTempDateTo(""); setDateToOpen(false); }}
                        >
                          مسح التاريخ
                        </button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 shrink-0 border-t pt-4 flex-row">
          <Button variant="outline" className="flex-1" onClick={handleClear}>
            <X className="h-4 w-4 ml-1.5" />
            إلغاء الفلاتر
          </Button>
          <Button className="flex-1" onClick={handleApply}>
            <SlidersHorizontal className="h-4 w-4 ml-1.5" />
            تطبيق الفلاتر
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inner component (uses useSearchParams) ───────────────────────────────────

function OrdersPageInner({ setImportOpen }: { setImportOpen: (open: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const role = session?.user?.role;

  // ── Statuses lookup ──
  const { data: statusesData, isLoading: statusesLoading, isError: statusesError } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const statuses = statusesData?.data ?? [];

  useEffect(() => {
    if (statusesError) toast.error("فشل تحميل قائمة الحالات");
  }, [statusesError]);

  // ── Users lookup (employee filter — managers/admins only) ──
  const canFilterByEmployee =
    role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER";

  const { data: usersData, isLoading: usersLoading } = useQuery<{ id: string; name: string; role: string }[]>({
    queryKey: ["lookup-users-filter", role, session?.user?.teamId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("role", "SALES");
      params.append("role", "SUPPORT");
      if (role === "SALES_MANAGER" && session?.user?.teamId) {
        params.set("teamId", session.user.teamId);
      }
      const res = await fetch(`/api/lookup/users?${params}`);
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: canFilterByEmployee,
    staleTime: 60_000,
  });
  const filterableUsers = usersData ?? [];

  // ── Countries lookup (admin/GM only) ──
  const canFilterByCountry = role === "ADMIN" || role === "GENERAL_MANAGER";

  const { data: countriesData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()),
    enabled: canFilterByCountry,
    staleTime: 5 * 60 * 1000,
  });
  const filterableCountries = countriesData?.data ?? [];

  // ── URL state ──
  const page = parseInt(searchParams.get("page") ?? "1");
  const searchQ = searchParams.get("search") ?? "";
  const statusIds = searchParams.getAll("status");
  const countryIds = searchParams.getAll("country");
  const employeeIds = searchParams.getAll("employee");
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const hasActiveFilters =
    statusIds.length > 0 || countryIds.length > 0 || employeeIds.length > 0 || !!dateFrom || !!dateTo;
  const activeFilterCount =
    statusIds.length + countryIds.length + employeeIds.length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  // ── Local state ──
  const [searchInput, setSearchInput] = useState(searchQ);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [selectLimitedCount, setSelectLimitedCount] = useState<number | null>(null);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [exportFilterConfirmOpen, setExportFilterConfirmOpen] = useState(false);

  // ── Debounce search ──
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput) params.set("search", searchInput);
      else params.delete("search");
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "page") params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  // ── Query ──
  const queryString = searchParams.toString();
  const { data, isLoading, isFetching } = useQuery<PaginatedOrders>({
    queryKey: ["orders", queryString],
    queryFn: () =>
      fetch(`/api/orders?${queryString}&pageSize=${PAGE_SIZE}`).then((r) => r.json()),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const isSearching = searchInput !== searchQ || (isFetching && searchQ.length > 0);

  // ── Selection ──
  const allIds = data?.data.map((o) => o.id) ?? [];
  const allPageSelected =
    allIds.length > 0 && allIds.every((id) => selected.has(id));

  const hasSelection = selected.size > 0 || selectAllFiltered || selectLimitedCount !== null;

  const selectedCount = selectAllFiltered
    ? (data?.total ?? 0)
    : selectLimitedCount !== null
      ? selectLimitedCount
      : selected.size;

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectAllFiltered(false);
    setSelectLimitedCount(null);
  }, []);

  const toggleAll = () => {
    if (selectAllFiltered || selectLimitedCount !== null) {
      clearSelection();
      return;
    }
    if (allPageSelected) {
      setSelected((prev) => {
        const n = new Set(prev);
        allIds.forEach((id) => n.delete(id));
        return n;
      });
      return;
    }
    setSelected((prev) => {
      const n = new Set(prev);
      allIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectFirst = (n: number) => {
    setSelectLimitedCount(n);
    setSelectAllFiltered(false);
    setSelected(new Set());
  };

  // ── Helpers ──
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildFilters = useCallback(() => ({
    search: searchParams.get("search") || undefined,
    status: searchParams.getAll("status"),
    country: searchParams.getAll("country"),
    employee: searchParams.getAll("employee"),
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  }), [searchParams]);

  const buildBulkPayload = (action: "status" | "delete", statusId?: string) => {
    if (selectAllFiltered) {
      return { action, scope: "all" as const, filters: buildFilters(), ...(statusId && { statusId }) };
    }
    if (selectLimitedCount !== null) {
      return { action, scope: "limited" as const, limit: selectLimitedCount, filters: buildFilters(), ...(statusId && { statusId }) };
    }
    return { action, scope: "ids" as const, ids: Array.from(selected), ...(statusId && { statusId }) };
  };

  // ── Template download ──
  const handleTemplateDownload = async () => {
    try {
      const res = await fetch("/api/orders/template");
      if (!res.ok) { toast.error("فشل تحميل النموذج"); return; }
      const blob = await res.blob();
      downloadBlob(blob, "نموذج_الطلبات.xlsx");
    } catch {
      toast.error("فشل تحميل النموذج");
    }
  };

  // ── Export all matching filters ──
  const handleExportFiltered = async (confirmed = false) => {
    const total = data?.total ?? 0;
    if (!confirmed && total > EXPORT_WARN_THRESHOLD) {
      setExportFilterConfirmOpen(true);
      return;
    }
    setExportFilterConfirmOpen(false);
    setExportLoading(true);
    try {
      const res = await fetch("/api/orders/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "query", filters: buildFilters() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error((json as { error?: string }).error ?? "فشل التصدير");
        return;
      }
      downloadBlob(await res.blob(), `طلبات_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    } finally {
      setExportLoading(false);
    }
  };

  // ── Export selected / all filtered ──
  const handleExportSelected = async () => {
    if (selectAllFiltered || selectLimitedCount !== null) {
      return handleExportFiltered(true);
    }
    setExportLoading(true);
    try {
      const res = await fetch("/api/orders/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ids", orderIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error((json as { error?: string }).error ?? "فشل التصدير");
        return;
      }
      downloadBlob(await res.blob(), `طلبات_محددة_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    } finally {
      setExportLoading(false);
    }
  };

  // ── Bulk status confirm ──
  const handleBulkStatusConfirm = async (statusId: string) => {
    const payload = buildBulkPayload("status", statusId);
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "فشل التحديث"); return; }
    toast.success(`تم تحديث ${json.data.affected} طلب`);
    clearSelection();
    setBulkStatusOpen(false);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  // ── Bulk delete ──
  const handleBulkDelete = async () => {
    setBulkDeleteLoading(true);
    try {
      const payload = buildBulkPayload("delete");
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "فشل الحذف"); return; }
      toast.success(`تم حذف ${json.data.affected} طلب`);
      clearSelection();
      setBulkDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  // ── Filter actions ──
  const applyFilters = useCallback(
    ({ statuses: s, countries: c, employees: e, dateFrom: df, dateTo: dt }: FiltersApplyPayload) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("status");
      params.delete("country");
      params.delete("employee");
      params.delete("dateFrom");
      params.delete("dateTo");
      s.forEach((v) => params.append("status", v));
      c.forEach((v) => params.append("country", v));
      e.forEach((v) => params.append("employee", v));
      if (df) params.set("dateFrom", df);
      if (dt) params.set("dateTo", dt);
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`);
      setFilterModalOpen(false);
      clearSelection();
    },
    [searchParams, pathname, router, clearSelection]
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("country");
    params.delete("employee");
    params.delete("dateFrom");
    params.delete("dateTo");
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
    setFilterModalOpen(false);
    clearSelection();
  }, [searchParams, pathname, router, clearSelection]);

  const removeFilter = useCallback(
    (type: "status" | "country" | "employee", id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const current = params.getAll(type).filter((v) => v !== id);
      params.delete(type);
      current.forEach((v) => params.append(type, v));
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`);
      clearSelection();
    },
    [searchParams, pathname, router, clearSelection]
  );

  const removeDateFilter = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dateFrom");
    params.delete("dateTo");
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <AppLoadingOverlay open={exportLoading} message="جاري تصدير البيانات..." />

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">الطلبات</h1>
        <div className="flex items-center gap-2">
          {(role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SHIPPING") && (
            <GoogleSheetSyncButton
              onSyncDone={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
            />
          )}
          {(role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "SALES") && (
            <Button variant="outline" size="sm" onClick={() => handleExportFiltered()} disabled={exportLoading}>
              {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="mr-1 hidden sm:inline">تصدير</span>
            </Button>
          )}
          {(role === "ADMIN" || role === "SALES_MANAGER" || role === "SALES" || role === "SUPPORT") && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleTemplateDownload}>
                <FileDown className="h-4 w-4" />
                <span className="mr-1 hidden sm:inline">نموذج فارغ</span>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                <span className="mr-1">استيراد</span>
              </Button>
            </>
          )}
          {(role === "ADMIN" || role === "SALES" || role === "SUPPORT") && (
            <Button type="button" size="sm" onClick={() => router.push("/orders/new")}>
              <Plus className="h-4 w-4" />
              <span className="mr-1 hidden sm:inline">طلب جديد</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Search + Filters Button ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput
          className="w-[280px]"
          placeholder="بحث برقم الطلب أو اسم العميل أو الجوال..."
          value={searchInput}
          onChange={setSearchInput}
          isSearching={isSearching}
          dir="rtl"
        />

        <Button
          variant={hasActiveFilters ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterModalOpen(true)}
          className="gap-1.5 h-9"
          disabled={statusesLoading}
        >
          <SlidersHorizontal className="h-4 w-4" />
          الفلاتر
          {activeFilterCount > 0 && (
            <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold px-1">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* ── Active Filter Chips ── */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {statusIds.map((id) => {
            const s = statuses.find((x) => x.id === id);
            return (
              <FilterChip
                key={id}
                label={s?.name ?? id}
                color={s?.color}
                onRemove={() => removeFilter("status", id)}
              />
            );
          })}
          {countryIds.map((id) => {
            const c = filterableCountries.find((x) => x.id === id);
            return (
              <FilterChip
                key={id}
                label={c?.name ?? id}
                onRemove={() => removeFilter("country", id)}
              />
            );
          })}
          {employeeIds.map((id) => {
            const e = filterableUsers.find((x) => x.id === id);
            return (
              <FilterChip
                key={id}
                label={e?.name ?? id}
                onRemove={() => removeFilter("employee", id)}
              />
            );
          })}
          {(dateFrom || dateTo) && (
            <FilterChip
              label={
                dateFrom && dateTo
                  ? `${dateFrom} ← ${dateTo}`
                  : dateFrom
                    ? `من ${dateFrom}`
                    : `حتى ${dateTo}`
              }
              onRemove={removeDateFilter}
            />
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors font-medium"
          >
            مسح الكل
          </button>
        </div>
      )}

      {/* ── Bulk Actions Bar (shown when selection is active) ── */}
      {hasSelection && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/15">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              تم تحديد{" "}
              <strong className="text-primary">{selectedCount.toLocaleString("ar")}</strong>{" "}
              طلب
              {selectAllFiltered && (
                <span className="text-xs font-normal text-muted-foreground mr-1">(كل النتائج)</span>
              )}
              {selectLimitedCount !== null && (
                <span className="text-xs font-normal text-muted-foreground mr-1">(الأوائل)</span>
              )}
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground" onClick={clearSelection}>
              <X className="h-3.5 w-3.5 ml-1" />
              إلغاء
            </Button>
          </div>

          <Popover open={bulkMenuOpen} onOpenChange={setBulkMenuOpen}>
            <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors h-8">
              <ListChecks className="h-4 w-4" />
              إجراءات جماعية
              <ChevronDown className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1.5 space-y-0.5">

              {/* Export — all users */}
              <button
                type="button"
                onClick={() => { setBulkMenuOpen(false); handleExportSelected(); }}
                disabled={exportLoading}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-right disabled:opacity-50"
              >
                {exportLoading
                  ? <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" />
                  : <Download className="h-4 w-4 shrink-0 opacity-70" />}
                تصدير المحدد إلى Excel
              </button>

              {/* Change Status — admin, GM, shipping */}
              {(role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SHIPPING") && (
                <button
                  type="button"
                  onClick={() => { setBulkMenuOpen(false); setBulkStatusOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-right"
                >
                  <RefreshCw className="h-4 w-4 shrink-0 opacity-70" />
                  تغيير حالة الشحن
                </button>
              )}

              {/* Delete — admin, GM */}
              {(role === "ADMIN" || role === "GENERAL_MANAGER") && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    type="button"
                    onClick={() => { setBulkMenuOpen(false); setBulkDeleteConfirm(true); }}
                    disabled={bulkDeleteLoading}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-red-50 text-red-600 transition-colors text-right disabled:opacity-50"
                  >
                    {bulkDeleteLoading
                      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      : <Trash2 className="h-4 w-4 shrink-0" />}
                    حذف المحدد
                  </button>
                </>
              )}

            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* ── Select All / First N Banner (shown after page selection, more results exist) ── */}
      {selected.size > 0 && !selectAllFiltered && selectLimitedCount === null &&
        data && data.total > allIds.length && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 rounded-lg bg-muted/40 border border-border text-sm">
          <span className="text-muted-foreground">
            تم تحديد <strong>{selected.size}</strong> طلب من الصفحة الحالية فقط
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            {data.total > 50 && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                تحديد أول:
                {[50, 100, 200].filter((n) => n < data.total).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => selectFirst(n)}
                    className="text-primary hover:underline font-medium"
                  >
                    {n}
                  </button>
                ))}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setSelectAllFiltered(true); setSelected(new Set()); setSelectLimitedCount(null); }}
              className="text-primary hover:underline text-xs font-semibold"
            >
              تحديد جميع {data.total.toLocaleString("ar")} طلب
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selectAllFiltered || selectLimitedCount !== null || allPageSelected}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>رقم الطلب</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الدولة</TableHead>
              <TableHead>المنتجات</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>المنشئ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  لا توجد طلبات
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((order) => (
                <TableRow
                  key={order.id}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-colors",
                    selected.has(order.id) && "bg-primary/5 hover:bg-primary/8"
                  )}
                  onClick={() => router.push(`/orders/${order.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(order.id)}
                      onCheckedChange={() => toggleOne(order.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{order.orderNumber}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{order.customerName}</span>
                      {order.isRepeatCustomer && (
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 border border-orange-200">
                          مكرر
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{order.phone}</div>
                  </TableCell>
                  <TableCell>{order.country.name}</TableCell>
                  <TableCell className="max-w-[180px]">
                    <div className="truncate text-sm">
                      {order.items.map((i) => `${i.product.name} (${i.quantity})`).join("، ")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{order.totalAmount.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground mr-1">{order.currency.code}</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-xs border"
                      style={{
                        backgroundColor: order.status.color + "22",
                        color: order.status.color,
                        borderColor: order.status.color + "55",
                      }}
                    >
                      {order.status.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatOrderDate(order.orderDate)}
                  </TableCell>
                  <TableCell className="text-sm">{order.createdBy.name}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination ── */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            صفحة {data.page} من {data.totalPages} — {data.total.toLocaleString("ar")} طلب
          </span>
          <PaginationArrows
            page={page}
            totalPages={data.totalPages}
            onPrev={() => updateParam("page", String(page - 1))}
            onNext={() => updateParam("page", String(page + 1))}
          />
        </div>
      )}

      {/* ── Filters Modal ── */}
      <FiltersModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        statuses={statuses}
        countries={filterableCountries}
        employees={filterableUsers}
        canFilterByEmployee={canFilterByEmployee && !usersLoading}
        canFilterByCountry={canFilterByCountry}
        currentStatuses={statusIds}
        currentCountries={countryIds}
        currentEmployees={employeeIds}
        currentDateFrom={dateFrom}
        currentDateTo={dateTo}
        onApply={applyFilters}
        onClear={clearFilters}
      />

      {/* ── Bulk Status Dialog ── */}
      <BulkStatusDialog
        open={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        count={selectedCount}
        onConfirm={handleBulkStatusConfirm}
      />

      {/* ── Bulk Delete Confirm ── */}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={setBulkDeleteConfirm}
        title="حذف الطلبات المحددة"
        description={`هل أنت متأكد من حذف ${selectedCount.toLocaleString("ar")} طلب؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        onConfirm={handleBulkDelete}
        loading={bulkDeleteLoading}
        variant="destructive"
      />

      {/* ── Large Export Confirm ── */}
      <ConfirmDialog
        open={exportFilterConfirmOpen}
        onOpenChange={setExportFilterConfirmOpen}
        title="تصدير عدد كبير من الطلبات"
        description={`سيتم تصدير جميع الطلبات المطابقة للفلاتر (${(data?.total ?? 0).toLocaleString("ar")} طلب). هل تريد المتابعة؟`}
        confirmLabel="تصدير إلى Excel"
        cancelLabel="إلغاء"
        onConfirm={() => handleExportFiltered(true)}
      />
    </div>
  );
}

// ─── Outer wrapper with Suspense ──────────────────────────────────────────────

export default function OrdersPage() {
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <>
      <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
        <OrdersPageInner setImportOpen={setImportOpen} />
      </Suspense>
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["orders"] });
        }}
      />
    </>
  );
}
