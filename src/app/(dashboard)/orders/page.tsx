"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  Plus, Download, Upload, Loader2, ChevronRight, ChevronLeft,
  Filter, X, CalendarIcon, FileDown, AlertCircle, CheckCircle2, Trash2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
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
    // Defer so the dialog can close before the toast fires
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

  // Use a ref to trigger the file input — more reliable inside Dialog portals than htmlFor
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreviewRows([]);
    setDupPhones({});
    setResult(null);
    setLoading(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // Validate extension client-side before doing anything heavy
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      toast.error("الملف غير مدعوم — استخدم .xlsx أو .xls فقط");
      e.target.value = "";
      return;
    }

    setFile(f);

    // Parse the workbook client-side for preview — wrapped in try/catch so a
    // malformed file doesn't silently swallow the event.
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

      // Prefer the sheet named "الطلبات"; fall back to whichever sheet has the
      // most required-header matches (handles files with hidden reference sheets).
      const REQUIRED = ["اسم العميل", "الجوال", "العنوان", "الدولة", "العملة", "طريقة الدفع", "المنتج", "الكمية", "السعر"];
      const norm = (v: unknown) => String(v ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();

      let sheetName = wb.SheetNames.find((n) => n === "الطلبات") ?? wb.SheetNames[0];
      // Scan if exact name not found
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

      // Read all rows as arrays to find the true header row (scan first 10 rows)
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

      // Hint/instruction rows left over from older templates
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
          // Drop blank rows
          Object.values(obj).some((v) => String(v ?? "").trim() !== "") &&
          // Drop instruction/hint rows from older templates
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

    // Batch duplicate check — non-critical; failure is silently ignored
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
        // non-critical; skip
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
        if (created > 0) {
          onDone(); // invalidate orders list
        }
        if (importErrors.length === 0) {
          // Clean import — close dialog and show toast
          toast.success(`تم استيراد ${created} طلب بنجاح`);
          handleClose();
        } else {
          // Partial or full failure — show result step so user can see per-row errors
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
      {/*
       * flex flex-col + max-h-[90dvh]: caps dialog height so footer is always
       * on screen; overrides the base "grid" class via tailwind-merge.
       */}
      <DialogContent dir="rtl" className="max-w-2xl flex flex-col max-h-[90dvh]">
        <DialogErrorBoundary onError={handleClose}>
          {/* Absolute loading overlay — sits over the whole popup (popup is `fixed`,
              so `absolute inset-0` covers it without a wrapping `relative` div) */}
          <AppLoadingOverlay open={loading} mode="inline" message="جاري استيراد الطلبات..." />

          {/* ── Header (pinned, never scrolls) ──────────────────────────────── */}
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              استيراد الطلبات من Excel
            </DialogTitle>
          </DialogHeader>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* ── Scrollable body (grows, shrinks, scrolls internally) ────────── */}
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

                {Object.keys(dupPhones).length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-sm text-orange-800">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>
                      تم اكتشاف{" "}
                      <strong>{Object.keys(dupPhones).length}</strong> رقم جوال مكرر — سيتم تمييز الطلبات كعملاء مكررين عند الاستيراد
                    </span>
                  </div>
                )}

                {/*
                 * Preview table — plain <table> (not the Table UI component) to
                 * avoid the nested overflow-x-auto wrapper that fights RTL layout.
                 *
                 * Scroll wrapper: dir="rtl" matches dialog direction so horizontal
                 * overflow extends to the left (less-important columns) not the right.
                 * min-w-max on <table> forces it to its natural content width and lets
                 * the wrapper show a horizontal scrollbar when needed.
                 */}
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
                        const phone = String(row["الجوال"] ?? "").trim();
                        const isDup = !!dupPhones[phone];
                        return (
                          <tr key={i} className={cn("border-b last:border-0", isDup ? "bg-orange-50/60" : "hover:bg-muted/30")}>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{i + 1}</td>
                            {PREVIEW_HEADERS.map((h) => (
                              <td key={h} className="px-3 py-1.5 text-right whitespace-nowrap">
                                {h === "الجوال" && isDup ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span>{String(row[h] ?? "")}</span>
                                    <span className="inline-flex rounded-full bg-orange-100 px-1 py-0.5 text-[9px] font-medium text-orange-700 border border-orange-200">مكرر</span>
                                  </span>
                                ) : (
                                  String(row[h] ?? "")
                                )}
                              </td>
                            ))}
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

          {/* ── Footer (pinned, never scrolls) ──────────────────────────────── */}
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
  selectedIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  onDone: () => void;
}) {
  const [statusId, setStatusId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const statuses = statusesData?.data ?? [];

  const handleClose = () => {
    setStatusId("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!statusId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", ids: selectedIds, statusId }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "فشل التحديث"); return; }
      toast.success(`تم تحديث ${json.data.affected} طلب`);
      setStatusId("");
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تغيير حالة {selectedIds.length} طلب</DialogTitle>
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

// ─── Inner component (uses useSearchParams) ───────────────────────────────────

function OrdersPageInner({ setImportOpen }: { setImportOpen: (open: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const role = session?.user?.role;

  // ── Statuses lookup ──
  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const statuses = statusesData?.data ?? [];

  // ── URL state ──
  const page = parseInt(searchParams.get("page") ?? "1");
  const searchQ = searchParams.get("search") ?? "";
  const statusParams = searchParams.getAll("status");
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  // ── Local state ──
  const [searchInput, setSearchInput] = useState(searchQ);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
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
  }, [searchInput]);

  const updateParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  const toggleStatus = useCallback((s: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const current = params.getAll("status");
    if (current.includes(s)) {
      params.delete("status");
      current.filter((x) => x !== s).forEach((x) => params.append("status", x));
    } else {
      params.append("status", s);
    }
    params.set("page", "1");
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

  // ── Select all ──
  const allIds = data?.data.map((o) => o.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => { const n = new Set(prev); allIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((prev) => { const n = new Set(prev); allIds.forEach((id) => n.add(id)); return n; });
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
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

  const buildFilters = () => ({
    search: searchParams.get("search") || undefined,
    status: searchParams.getAll("status"),
    countryId: searchParams.getAll("countryId"),
    currencyId: searchParams.get("currencyId") || undefined,
    paymentMethodId: searchParams.get("paymentMethodId") || undefined,
    createdById: searchParams.get("createdById") || undefined,
    teamId: searchParams.get("teamId") || undefined,
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  // ── Template download ──
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

  // ── Export all matching filters (mode B) — used by header button and banner ──
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

  // ── Export selected IDs (mode A) ──
  const handleExportSelected = async () => {
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

  // ── Bulk delete ──
  const handleBulkDelete = async () => {
    setBulkDeleteLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: Array.from(selected) }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "فشل الحذف"); return; }
      toast.success(`تم حذف ${json.data.affected} طلب`);
      setSelected(new Set());
      setBulkDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const hasActiveFilters = statusParams.length > 0 || dateFrom || dateTo;

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("dateFrom");
    params.delete("dateTo");
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <AppLoadingOverlay open={exportLoading} message="جاري تصدير البيانات..." />
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">الطلبات</h1>
        <div className="flex items-center gap-2">
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

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <SearchInput
          className="w-[30%] min-w-[220px]"
          placeholder="بحث برقم الطلب أو اسم العميل أو الجوال..."
          value={searchInput}
          onChange={setSearchInput}
          isSearching={isSearching}
          dir="rtl"
        />

        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted",
              hasActiveFilters && "border-primary text-primary"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            {hasActiveFilters && <span>فلتر</span>}
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4 space-y-4" align="end">
            <div className="space-y-2">
              <Label className="text-sm font-medium">الحالة</Label>
              <div className="grid grid-cols-2 gap-2">
                {statuses.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`status-${s.id}`}
                      checked={statusParams.includes(s.id)}
                      onCheckedChange={() => toggleStatus(s.id)}
                    />
                    <label htmlFor={`status-${s.id}`} className="text-xs cursor-pointer">
                      {s.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">من تاريخ</Label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger
                  className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                >
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

            <div className="space-y-2">
              <Label className="text-sm font-medium">إلى تاريخ</Label>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger
                  className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                >
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

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="w-full" onClick={clearFilters}>
                <X className="h-3 w-3 ml-1" />
                مسح الفلاتر
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">
            تم تحديد {selected.size} طلب
          </span>
          <div className="flex items-center gap-2 mr-auto">
            {(role === "ADMIN" || role === "GENERAL_MANAGER" || role === "SALES_MANAGER" || role === "SALES") && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportSelected}
                  disabled={exportLoading}
                >
                  {exportLoading
                    ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                    : <Download className="h-4 w-4 ml-1" />
                  }
                  المحدد في الصفحة ({selected.size})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExportFiltered()}
                  disabled={exportLoading}
                >
                  <Download className="h-4 w-4 ml-1" />
                  تحديد الكل حسب الفلاتر
                  {data?.total != null && ` (${data.total.toLocaleString("ar")})`}
                </Button>
              </>
            )}
            {(role === "ADMIN" || role === "SALES_MANAGER") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkStatusOpen(true)}
              >
                <RefreshCw className="h-4 w-4 ml-1" />
                تغيير الحالة
              </Button>
            )}
            {role === "ADMIN" && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBulkDeleteConfirm(true)}
                disabled={bulkDeleteLoading}
              >
                {bulkDeleteLoading
                  ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                  : <Trash2 className="h-4 w-4 ml-1" />
                }
                حذف المحدد
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              إلغاء التحديد
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
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
                  className="cursor-pointer hover:bg-muted/50"
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
                    <Badge variant="outline" className="text-xs border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
                      {order.status.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(order.orderDate), "dd/MM/yyyy", { locale: arSA })}
                  </TableCell>
                  <TableCell className="text-sm">{order.createdBy.name}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {data.total} طلب — صفحة {data.page} من {data.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => updateParam("page", String(page - 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span>{page}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= (data?.totalPages ?? 1)}
              onClick={() => updateParam("page", String(page + 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Status Dialog */}
      <BulkStatusDialog
        open={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        selectedIds={Array.from(selected)}
        onDone={() => {
          setBulkStatusOpen(false);
          setSelected(new Set());
          queryClient.invalidateQueries({ queryKey: ["orders"] });
        }}
      />

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={setBulkDeleteConfirm}
        title="حذف الطلبات المحددة"
        description={`هل أنت متأكد من حذف ${selected.size} طلب؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        onConfirm={handleBulkDelete}
        loading={bulkDeleteLoading}
        variant="destructive"
      />

      {/* Large Export Confirm */}
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
