"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Loader2, Truck, ExternalLink, RefreshCw, CheckSquare } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AppLoadingOverlay } from "@/components/shared/AppLoadingOverlay";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShippingCompany = { id: string; name: string; trackingUrl: string | null };
type ShippingStatusSub = { id: string; name: string; colorOverride: string | null; marksOrderDelivered: boolean; sortOrder: number };
type ShippingStatusItem = { id: string; name: string; color: string; sortOrder: number; subs: ShippingStatusSub[] };

type UnifiedOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  phone: string;
  status: ShippingStatusItem;
  totalAmount: number;
  country: { id: string; name: string };
  currency: { id: string; code: string; symbol: string };
  createdBy: { id: string; name: string };
  items: { quantity: number; product: { id: string; name: string } }[];
  shippingInfo: {
    id: string;
    trackingNumber: string | null;
    shippedAt: string;
    deliveredAt: string | null;
    shippingCompany: ShippingCompany;
    shippedBy: { id: string; name: string };
    shippingSubStatus: {
      id: string;
      name: string;
      colorOverride: string | null;
      marksOrderDelivered: boolean;
      primary: { id: string; name: string; color: string };
    } | null;
  } | null;
};

type TabDef = {
  id: string;         // "all" | "ss-{shippingStatusId}"
  label: string;
  type: "all" | "shippingStatus";
  color?: string;     // for shippingStatus tabs
};

// ─── Ship Dialog ──────────────────────────────────────────────────────────────

function ShipDialog({
  order,
  companies,
  statuses,
  open,
  onClose,
  onShipped,
}: {
  order: UnifiedOrder | null;
  companies: ShippingCompany[];
  statuses: ShippingStatusItem[];
  open: boolean;
  onClose: () => void;
  onShipped: () => void;
}) {
  const [companyId, setCompanyId] = useState("");
  const [subStatusId, setSubStatusId] = useState("");
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => { setCompanyId(""); setSubStatusId(""); setTracking(""); setNotes(""); setErrors({}); };
  const handleClose = () => { reset(); onClose(); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!companyId) e.company = "شركة الشحن مطلوبة";
    if (!subStatusId) e.status = "حالة الشحن مطلوبة";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!order || !validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          shippingCompanyId: companyId,
          subStatusId,
          trackingNumber: tracking.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      let json: { error?: string } = {};
      try { json = await res.json(); } catch { /* non-JSON response */ }
      if (!res.ok) { toast.error(json.error ?? "فشل الشحن"); return; }
      toast.success(`تم شحن الطلب ${order.orderNumber}`);
      reset();
      onShipped();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-md relative">
        <AppLoadingOverlay open={loading} mode="inline" message="جاري تسجيل الشحن..." />
        <DialogHeader>
          <DialogTitle>شحن الطلب {order?.orderNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>شركة الشحن</Label>
            <SearchableSelect
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              value={companyId}
              onChange={setCompanyId}
              placeholder="اختر شركة الشحن"
              error={!!errors.company}
            />
            {errors.company && <p className="text-xs text-destructive">{errors.company}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>حالة الشحن</Label>
            <SearchableSelect
              options={statuses.flatMap((p) =>
                p.subs.map((s) => ({
                  value: s.id,
                  label: `${p.name} — ${s.name}`,
                  group: p.name,
                }))
              )}
              value={subStatusId}
              onChange={setSubStatusId}
              placeholder="اختر حالة الشحن"
              error={!!errors.status}
            />
            {errors.status && <p className="text-xs text-destructive">{errors.status}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>رقم التتبع (اختياري)</Label>
            <Input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="رقم التتبع"
              dir="ltr"
            />
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات الشحن..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Truck className="h-4 w-4 ml-1" />}
            تأكيد الشحن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Ship Dialog ─────────────────────────────────────────────────────────

function BulkShipDialog({
  orders,
  companies,
  statuses,
  open,
  onClose,
  onShipped,
}: {
  orders: UnifiedOrder[];
  companies: ShippingCompany[];
  statuses: ShippingStatusItem[];
  open: boolean;
  onClose: () => void;
  onShipped: () => void;
}) {
  const [companyId, setCompanyId] = useState("");
  const [subStatusId, setSubStatusId] = useState("");
  const [trackingPrefix, setTrackingPrefix] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setCompanyId(""); setSubStatusId(""); setTrackingPrefix(""); setNotes("");
    setErrors({}); setProgress({ done: 0, total: 0 });
  };

  const handleClose = () => { if (loading) return; reset(); onClose(); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!companyId) e.company = "شركة الشحن مطلوبة";
    if (!subStatusId) e.status = "حالة الشحن مطلوبة";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    setProgress({ done: 0, total: orders.length });
    let succeeded = 0;
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const trackingNumber = trackingPrefix
        ? `${trackingPrefix}-${String(i + 1).padStart(3, "0")}`
        : `BULK-${order.orderNumber}`;
      try {
        const res = await fetch("/api/shipping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.id,
            shippingCompanyId: companyId,
            subStatusId,
            trackingNumber: trackingNumber || undefined,
            notes: notes.trim() || undefined,
          }),
        });
        if (res.ok) succeeded++;
      } catch { /* continue */ }
      setProgress({ done: i + 1, total: orders.length });
    }
    toast.success(`تم شحن ${succeeded} من ${orders.length} طلب`);
    setLoading(false);
    reset();
    onShipped();
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-md relative">
        <AppLoadingOverlay
          open={loading}
          mode="inline"
          message={progress.total > 0 ? `جاري الشحن... ${progress.done} / ${progress.total}` : "جاري المعالجة..."}
        />
        <DialogHeader>
          <DialogTitle>شحن {orders.length} طلب دفعة واحدة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>شركة الشحن</Label>
            <SearchableSelect
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              value={companyId}
              onChange={setCompanyId}
              placeholder="اختر شركة الشحن"
              error={!!errors.company}
            />
            {errors.company && <p className="text-xs text-destructive">{errors.company}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>حالة الشحن</Label>
            <SearchableSelect
              options={statuses.flatMap((p) =>
                p.subs.map((s) => ({
                  value: s.id,
                  label: `${p.name} — ${s.name}`,
                  group: p.name,
                }))
              )}
              value={subStatusId}
              onChange={setSubStatusId}
              placeholder="اختر حالة الشحن"
              error={!!errors.status}
            />
            {errors.status && <p className="text-xs text-destructive">{errors.status}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>بادئة رقم التتبع (اختياري)</Label>
            <Input
              value={trackingPrefix}
              onChange={(e) => setTrackingPrefix(e.target.value)}
              placeholder="مثال: DHL — سيتم إضافة -001، -002... تلقائياً"
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">إذا تُركت فارغة، يُستخدم رقم الطلب تلقائياً</p>
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات مشتركة للشحنات..."
              rows={2}
            />
          </div>
          {loading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>جار الشحن...</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Truck className="h-4 w-4 ml-1" />}
            تأكيد الشحن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Shipping Status Dialog ──────────────────────────────────────────────

function BulkShippingStatusDialog({
  orderIds,
  statuses,
  companies,
  open,
  loading,
  onClose,
  onSubmit,
}: {
  orderIds: string[];
  statuses: ShippingStatusItem[];
  companies: ShippingCompany[];
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (subStatusId: string, shippingCompanyId?: string) => void;
}) {
  const [subStatusId, setSubStatusId] = useState("");
  const [companyId, setCompanyId] = useState("");

  // Reset selections each time the dialog opens
  useEffect(() => {
    if (open) { setSubStatusId(""); setCompanyId(""); }
  }, [open]);

  const handleClose = () => {
    if (loading) return;
    setSubStatusId(""); setCompanyId("");
    onClose();
  };

  const handleConfirm = () => {
    if (!subStatusId || orderIds.length === 0 || loading) return;
    onSubmit(subStatusId, companyId || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تغيير حالة {orderIds.length} طلب</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>الحالة الجديدة <span className="text-destructive">*</span></Label>
            <SearchableSelect
              options={statuses.flatMap((p) =>
                p.subs.map((s) => ({
                  value: s.id,
                  label: `${p.name} — ${s.name}`,
                  group: p.name,
                }))
              )}
              value={subStatusId}
              onChange={setSubStatusId}
              placeholder="اختر حالة الشحن"
            />
          </div>
          <div className="space-y-1.5">
            <Label>شركة الشحن <span className="text-muted-foreground text-xs">(اختياري — يُغيّر شركة الشحن لجميع الطلبات المحددة)</span></Label>
            <SearchableSelect
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              value={companyId}
              onChange={setCompanyId}
              placeholder="اتركه فارغاً للإبقاء على الشركة الحالية"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button type="button" onClick={handleConfirm} disabled={!subStatusId || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Single Status Dialog ─────────────────────────────────────────────────────

function SingleStatusDialog({
  order,
  statuses,
  open,
  onClose,
  onDone,
}: {
  order: UnifiedOrder | null;
  statuses: ShippingStatusItem[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [subStatusId, setSubStatusId] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => setSubStatusId("");
  const handleClose = () => { if (loading) return; reset(); onClose(); };

  const handleSubmit = async () => {
    if (!order?.shippingInfo || !subStatusId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/shipping/${order.shippingInfo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subStatusId }),
      });
      let json: { error?: string; data?: { isDelivered?: boolean } } = {};
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) { toast.error(json.error ?? "فشل تحديث الحالة"); return; }
      toast.success(json.data?.isDelivered ? "تم تسجيل التسليم بنجاح" : "تم تحديث حالة الشحن");
      reset();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تغيير الحالة</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-0.5">
            <div className="font-medium font-mono">{order.orderNumber}</div>
            <div className="text-muted-foreground">{order.customerName}</div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>الحالة الجديدة</Label>
          <SearchableSelect
            options={statuses.flatMap((p) =>
              p.subs.map((s) => ({
                value: s.id,
                label: `${p.name} — ${s.name}`,
                group: p.name,
              }))
            )}
            value={subStatusId}
            onChange={setSubStatusId}
            placeholder="اختر الحالة"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={!subStatusId || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShippingPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("all");
  const [shipTarget, setShipTarget] = useState<UnifiedOrder | null>(null);
  const [statusTarget, setStatusTarget] = useState<UnifiedOrder | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkShipOpen, setBulkShipOpen] = useState(false);

  // ── Explicit bulk-status state machine ──
  // Snapshot IDs when dialog opens so selection changes mid-flight can't corrupt the list.
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);

  // Safety: @base-ui may leave pointer-events:none or overflow:hidden on body after a modal closes.
  // This effect fires whenever ANY dialog fully closes and resets those inline styles.
  const anyDialogOpen = !!shipTarget || !!statusTarget || bulkShipOpen || bulkStatusOpen || bulkLoading;
  useEffect(() => {
    if (!anyDialogOpen) {
      document.body.style.pointerEvents = "";
      document.body.style.overflow = "";
    }
  }, [anyDialogOpen]);

  const role = session?.user?.role;
  const isAllowed = role === "ADMIN" || role === "SHIPPING";

  // ── Lookups ──
  const { data: companies = [] } = useQuery<ShippingCompany[]>({
    queryKey: ["lookup-shipping-companies"],
    queryFn: () => fetch("/api/lookup/shipping-companies").then((r) => r.json()).then((r) => r.data),
    enabled: isAllowed,
    staleTime: 5 * 60_000,
  });

  const { data: shippingStatuses = [] } = useQuery<ShippingStatusItem[]>({
    queryKey: ["lookup-shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()).then((r) => r.data),
    enabled: isAllowed,
    staleTime: 5 * 60_000,
  });

  // ── All orders — single unified query ──
  const { data: allOrders = [], isLoading, refetch } = useQuery<UnifiedOrder[]>({
    queryKey: ["shipping-all"],
    queryFn: () => fetch("/api/shipping").then((r) => r.json()).then((r) => r.data),
    enabled: isAllowed,
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  // ── Build tab list (only ShippingStatus DB tabs + "الكل") ──
  const allTabs: TabDef[] = useMemo(() => [
    { id: "all", label: "الكل", type: "all" },
    ...shippingStatuses.map((s): TabDef => ({
      id: `ss-${s.id}`,
      label: s.name,
      type: "shippingStatus",
      color: s.color,
    })),
  ], [shippingStatuses]);

  // ── Tab counts — computed from all orders ──
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allOrders.length };
    for (const order of allOrders) {
      const ssKey = `ss-${order.status.id}`;
      counts[ssKey] = (counts[ssKey] ?? 0) + 1;
    }
    return counts;
  }, [allOrders]);

  // ── Visible tabs — hide SS tabs with 0 orders ──
  const visibleTabs = useMemo(() =>
    allTabs.filter((tab) => tab.id === "all" || (tabCounts[tab.id] ?? 0) > 0),
  [allTabs, tabCounts]);

  // ── Filtered orders for active tab ──
  const filteredOrders = useMemo(() => {
    if (activeTab === "all") return allOrders;
    if (activeTab.startsWith("ss-")) {
      const ssId = activeTab.slice(3);
      return allOrders.filter((o) => o.status.id === ssId);
    }
    return allOrders;
  }, [allOrders, activeTab]);

  // ── Selection ──
  const allFilteredIds = filteredOrders.map((o) => o.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const n = new Set(prev);
        allFilteredIds.forEach((id) => n.delete(id));
        return n;
      });
    } else {
      setSelected((prev) => {
        const n = new Set(prev);
        allFilteredIds.forEach((id) => n.add(id));
        return n;
      });
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // ── Derived from selection ──
  const selectedOrders = filteredOrders.filter((o) => selected.has(o.id));
  const selectedReadyOrders = selectedOrders.filter((o) => o.status.name === "جاهز للشحن");

  // ── Post-action invalidation ──
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["shipping-all"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const handleShipped = () => {
    setShipTarget(null);
    setSelected(new Set());
    invalidateAll();
  };

  const handleBulkShipDone = () => {
    setBulkShipOpen(false);
    setSelected(new Set());
    invalidateAll();
  };

  const openBulkStatusDialog = () => {
    const ids = filteredOrders.filter((o) => selected.has(o.id)).map((o) => o.id);
    console.log("[bulk-status] open dialog — snapshotting", ids.length, "ids");
    setBulkSelectedIds(ids);
    setBulkStatusOpen(true);
  };

  const handleBulkStatusSubmit = async (subStatusId: string, shippingCompanyId?: string) => {
    if (bulkLoading || bulkSelectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/shipping/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: bulkSelectedIds,
          subStatusId,
          ...(shippingCompanyId && { shippingCompanyId }),
        }),
      });
      let json: { error?: string; data?: { updatedCount: number; errors: { orderId: string; message: string }[] } } = {};
      try { json = await res.json(); } catch { /* non-JSON fallback */ }
      if (!res.ok) {
        toast.error(json.error ?? "فشل تحديث الحالة");
        return;
      }
      const { updatedCount, errors } = json.data ?? { updatedCount: 0, errors: [] };
      if (errors.length > 0) {
        toast.error(`تم تحديث ${updatedCount} من ${bulkSelectedIds.length}، فشل ${errors.length} طلب`);
      } else {
        toast.success(`تم تحديث ${updatedCount} طلب بنجاح`);
      }
      console.log("[bulk-status] done — updated:", updatedCount);
      setBulkStatusOpen(false);
      setBulkSelectedIds([]);
      setSelected(new Set());
      invalidateAll();
    } catch (err) {
      console.error("[bulk-status] error:", err);
      toast.error(err instanceof Error ? err.message : "حدث خطأ في الاتصال");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleStatusDone = () => {
    setStatusTarget(null);
    invalidateAll();
  };

  // ── Tab change ──
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSelected(new Set());
  };

  return (
    <div className="p-6 space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">لوحة الشحن</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* Tab bar — scrollable, dynamic */}
      <div className="overflow-x-auto pb-1" role="tablist" aria-label="تصفية الطلبات">
        <div className="inline-flex bg-muted p-1 rounded-lg gap-0.5 min-w-full sm:min-w-0">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const count = tabCounts[tab.id] ?? 0;

            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                {tab.type === "shippingStatus" && tab.color && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tab.color }}
                  />
                )}
                {tab.label}
                {count > 0 && (
                  <Badge
                    variant={isActive ? "default" : "secondary"}
                    className="text-xs px-1.5 py-0 h-4 min-w-[1.25rem] flex items-center justify-center rounded-full"
                    style={
                      tab.type === "shippingStatus" && tab.color && isActive
                        ? { backgroundColor: tab.color, color: "#fff", borderColor: tab.color }
                        : undefined
                    }
                  >
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">
            تم تحديد {selected.size} طلب
          </span>
          <div className="flex items-center gap-2 mr-auto">
            {selectedReadyOrders.length > 0 && (
              <Button type="button" size="sm" onClick={() => setBulkShipOpen(true)} className="gap-1">
                <Truck className="h-3.5 w-3.5" />
                شحن ({selectedReadyOrders.length})
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openBulkStatusDialog}
              disabled={bulkLoading}
              className="gap-1"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              تغيير حالة المحدد ({selectedOrders.length})
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              إلغاء التحديد
            </Button>
          </div>
        </div>
      )}

      {/* Unified table */}
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
              <TableHead>حالة الطلب</TableHead>
              <TableHead>شركة الشحن / التتبع</TableHead>
              <TableHead>حالة الشحن</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>المنشئ</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead className="sticky left-0 bg-muted/40 z-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 12 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                  لا توجد طلبات
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow
                  key={order.id}
                  className={cn(selected.has(order.id) && "bg-blue-50/50", "cursor-pointer hover:bg-muted/50")}
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
                    <div className="font-medium">{order.customerName}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{order.phone}</div>
                  </TableCell>

                  <TableCell>{order.country.name}</TableCell>

                  <TableCell className="max-w-[150px]">
                    <div className="truncate text-sm">
                      {order.items.map((i) => `${i.product.name} (${i.quantity})`).join("، ")}
                    </div>
                  </TableCell>

                  {/* Status badge */}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-xs border"
                      style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}
                    >
                      {order.status.name}
                    </Badge>
                  </TableCell>

                  {/* Shipping company + tracking */}
                  <TableCell>
                    {order.shippingInfo ? (
                      <div>
                        <div className="text-sm font-medium">{order.shippingInfo.shippingCompany.name}</div>
                        <div className="flex items-center gap-1 mt-0.5" dir="ltr">
                          {order.shippingInfo.trackingNumber ? (
                            <>
                              <span className="font-mono text-xs text-muted-foreground">
                                {order.shippingInfo.trackingNumber}
                              </span>
                              {order.shippingInfo.shippingCompany.trackingUrl && (
                                <a
                                  href={order.shippingInfo.shippingCompany.trackingUrl.replace(
                                    "{tracking}",
                                    order.shippingInfo.trackingNumber
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:text-primary/80"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* ShippingStatus badge (from DB, colored) */}
                  <TableCell>
                    {order.shippingInfo?.shippingSubStatus ? (
                      (() => {
                        const sub = order.shippingInfo.shippingSubStatus;
                        const color = sub.colorOverride ?? sub.primary.color;
                        return (
                          <Badge
                            variant="outline"
                            style={{
                              borderColor: color,
                              color: color,
                              backgroundColor: color + "22",
                            }}
                            className="text-xs"
                          >
                            {sub.name}
                          </Badge>
                        );
                      })()
                    ) : order.shippingInfo ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <span className="font-medium">{order.totalAmount.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground mr-1">{order.currency.code}</span>
                  </TableCell>

                  <TableCell className="text-sm">{order.createdBy.name}</TableCell>

                  <TableCell className="text-sm whitespace-nowrap">
                    {format(new Date(order.orderDate), "dd/MM/yyyy", { locale: arSA })}
                  </TableCell>

                  {/* Actions — sticky left keeps buttons visible when table overflows in RTL */}
                  <TableCell
                    className="sticky left-0 z-[1] bg-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {order.status.name === "جاهز للشحن" ? (
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setShipTarget(order); }}
                        className="gap-1 whitespace-nowrap"
                      >
                        <Truck className="h-3.5 w-3.5" />
                        شحن
                      </Button>
                    ) : order.shippingInfo ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); setStatusTarget(order); }}
                        className="whitespace-nowrap"
                      >
                        تغيير الحالة
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Single Ship Dialog */}
      <ShipDialog
        order={shipTarget}
        companies={companies}
        statuses={shippingStatuses}
        open={!!shipTarget}
        onClose={() => setShipTarget(null)}
        onShipped={handleShipped}
      />

      {/* Bulk Ship Dialog */}
      <BulkShipDialog
        orders={selectedReadyOrders}
        companies={companies}
        statuses={shippingStatuses}
        open={bulkShipOpen}
        onClose={() => setBulkShipOpen(false)}
        onShipped={handleBulkShipDone}
      />

      {/* Bulk Shipping Status Dialog */}
      <BulkShippingStatusDialog
        orderIds={bulkSelectedIds}
        statuses={shippingStatuses}
        companies={companies}
        open={bulkStatusOpen}
        loading={bulkLoading}
        onClose={() => { if (!bulkLoading) setBulkStatusOpen(false); }}
        onSubmit={handleBulkStatusSubmit}
      />

      {/* Single Status Dialog */}
      <SingleStatusDialog
        order={statusTarget}
        statuses={shippingStatuses}
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={handleStatusDone}
      />
    </div>
  );
}
