"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { arSA } from "date-fns/locale";
import { Loader2, Truck, ExternalLink, RefreshCw, CheckSquare, X, CalendarIcon, ChevronDown, Search, Globe } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ShippingStatusDialog } from "@/components/shared/ShippingStatusDialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Country = { id: string; name: string; code: string };
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


// ─── Country multi-select ─────────────────────────────────────────────────────

type CountryMode = "include" | "exclude";

function CountryMultiSelect({
  countries,
  selectedIds,
  mode,
  onToggle,
  onModeChange,
  onClear,
}: {
  countries: Country[];
  selectedIds: Set<string>;
  mode: CountryMode;
  onToggle: (id: string) => void;
  onModeChange: (mode: CountryMode) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      search
        ? countries.filter((c) => c.name.includes(search))
        : countries,
    [countries, search],
  );

  const label =
    selectedIds.size === 0
      ? "كل الدول"
      : `${mode === "include" ? "تضمين" : "استثناء"} ${selectedIds.size} ${selectedIds.size === 1 ? "دولة" : "دول"}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors min-w-[150px]",
          selectedIds.size > 0
            ? "border-primary bg-primary/10 text-primary"
            : "border-input text-foreground hover:bg-muted",
        )}
      >
        <Globe className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-right">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* Mode toggle */}
        <div className="flex border-b">
          {(["include", "exclude"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "flex-1 py-2 text-xs font-medium transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              {m === "include" ? "تضمين" : "استثناء"}
            </button>
          ))}
        </div>
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="بحث..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {/* Country list */}
        <div className="max-h-48 overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              <Checkbox
                checked={selectedIds.has(c.id)}
                onCheckedChange={() => onToggle(c.id)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
              />
              {c.name}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">لا توجد نتائج</p>
          )}
        </div>
        {selectedIds.size > 0 && (
          <div className="border-t p-2">
            <button
              type="button"
              onClick={() => { onClear(); setOpen(false); }}
              className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
            >
              مسح التحديد
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShippingPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("all");
  const [selectedCountryIds, setSelectedCountryIds] = useState<Set<string>>(new Set());
  const [countryMode, setCountryMode] = useState<CountryMode>("include");
  // Date filter — "yyyy-MM-dd" strings; empty = no bound
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<UnifiedOrder | null>(null);
  const [rowStatusLoading, setRowStatusLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Explicit bulk-status state machine ──
  // Snapshot IDs when dialog opens so selection changes mid-flight can't corrupt the list.
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);

  // Safety: clear any residual overflow lock base-ui sets on body during dialog close.
  // Two passes: immediate (catches fast closes) + 150ms (catches animated closes).
  const anyDialogOpen = !!statusTarget || rowStatusLoading || bulkStatusOpen || bulkLoading;
  useEffect(() => {
    if (!anyDialogOpen) {
      const raf = requestAnimationFrame(() => {
        document.body.style.overflow = "";
      });
      const timer = setTimeout(() => {
        document.body.style.pointerEvents = "";
        document.body.style.overflow = "";
      }, 150);
      return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
    }
  }, [anyDialogOpen]);

  const role = session?.user?.role;
  const isAllowed = role === "ADMIN" || role === "SHIPPING";

  // ── Date filter helpers ──
  const todayStr     = format(new Date(), "yyyy-MM-dd");
  const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const isToday     = dateFrom === todayStr     && dateTo === todayStr;
  const isYesterday = dateFrom === yesterdayStr && dateTo === yesterdayStr;
  const hasDateFilter = !!(dateFrom || dateTo);

  const activeDateLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return null;
    if (dateFrom && dateTo && dateFrom === dateTo)
      return format(new Date(dateFrom), "d MMMM yyyy", { locale: arSA });
    const from = dateFrom ? format(new Date(dateFrom), "d MMM", { locale: arSA }) : "...";
    const to   = dateTo   ? format(new Date(dateTo),   "d MMM yyyy", { locale: arSA }) : "...";
    return `${from} — ${to}`;
  }, [dateFrom, dateTo]);

  const handleDatePreset = (preset: "today" | "yesterday" | "clear") => {
    setSelected(new Set());
    if (preset === "today")     { setDateFrom(todayStr);     setDateTo(todayStr); }
    else if (preset === "yesterday") { setDateFrom(yesterdayStr); setDateTo(yesterdayStr); }
    else                        { setDateFrom("");            setDateTo(""); }
  };

  // ── Lookups ──
  const { data: companies = [] } = useQuery<ShippingCompany[]>({
    queryKey: ["lookup-shipping-companies"],
    queryFn: () => fetch("/api/lookup/shipping-companies").then((r) => r.json()).then((r) => r.data),
    enabled: isAllowed,
    staleTime: 5 * 60_000,
  });

  const { data: countries = [] } = useQuery<Country[]>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()).then((r) => r.data),
    enabled: isAllowed,
    staleTime: 5 * 60_000,
  });

  const { data: shippingStatuses = [] } = useQuery<ShippingStatusItem[]>({
    queryKey: ["lookup-shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()).then((r) => r.data),
    enabled: isAllowed,
    staleTime: 5 * 60_000,
  });

  // ── All orders — re-fetched when any filter changes ──
  const { data: allOrders = [], isLoading, refetch } = useQuery<UnifiedOrder[]>({
    queryKey: ["shipping-all", countryMode, [...selectedCountryIds].sort().join(","), dateFrom, dateTo],
    queryFn: () => {
      const url = new URL("/api/shipping", window.location.origin);
      if (selectedCountryIds.size > 0) {
        url.searchParams.set("countryMode", countryMode);
        url.searchParams.set("countryIds", [...selectedCountryIds].join(","));
      }
      if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
      if (dateTo)   url.searchParams.set("dateTo",   dateTo);
      return fetch(url.toString()).then((r) => r.json()).then((r) => r.data);
    },
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

  // ── Post-action invalidation ──
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["shipping-all"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  // Shared status-change function: both bulk UI and per-row buttons call this.
  // Uses POST /api/shipping/bulk-update with a one-element array for single rows.
  const applyStatusChange = async (
    orderIds: string[],
    subStatusId: string,
    shippingCompanyId?: string,
    trackingNumber?: string,
  ): Promise<void> => {
    const res = await fetch("/api/shipping/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderIds,
        subStatusId,
        ...(shippingCompanyId && { shippingCompanyId }),
        // Only send trackingNumber when non-empty — omitting it preserves the existing value.
        ...(trackingNumber?.trim() && { trackingNumber: trackingNumber.trim() }),
      }),
    });
    let json: { error?: string; data?: { updatedCount: number; errors: { orderId: string; message: string }[] } } = {};
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      toast.error(json.error ?? "فشل تحديث الحالة");
      return;
    }
    const { updatedCount, errors } = json.data ?? { updatedCount: 0, errors: [] };
    if (errors.length > 0) {
      toast.error(`تم تحديث ${updatedCount} من ${orderIds.length}، فشل ${errors.length} طلب`);
    } else {
      toast.success(orderIds.length === 1 ? "تم تحديث حالة الطلب" : `تم تحديث ${updatedCount} طلب بنجاح`);
    }
    invalidateAll();
  };

  const openBulkStatusDialog = () => {
    const ids = filteredOrders.filter((o) => selected.has(o.id)).map((o) => o.id);
    setBulkSelectedIds(ids);
    setBulkStatusOpen(true);
  };

  const handleBulkStatusSubmit = async (subStatusId: string, shippingCompanyId?: string, trackingNumber?: string) => {
    if (bulkLoading || bulkSelectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      await applyStatusChange(bulkSelectedIds, subStatusId, shippingCompanyId, trackingNumber);
      setBulkStatusOpen(false);
      setBulkSelectedIds([]);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ في الاتصال");
    } finally {
      setBulkLoading(false);
    }
  };

  // Per-row status change: same flow as bulk but with a single order id.
  const handleRowStatusSubmit = async (subStatusId: string, shippingCompanyId?: string, trackingNumber?: string) => {
    if (!statusTarget) return;
    setRowStatusLoading(true);
    try {
      await applyStatusChange([statusTarget.id], subStatusId, shippingCompanyId, trackingNumber);
    } finally {
      setRowStatusLoading(false);
      setStatusTarget(null);
    }
  };

  // ── Tab change ──
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSelected(new Set());
  };

  // ── Country filter handlers ──
  const handleCountryToggle = (id: string) => {
    setSelectedCountryIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSelected(new Set());
  };

  const handleCountryModeChange = (mode: CountryMode) => {
    setCountryMode(mode);
    setSelectedCountryIds(new Set());
    setSelected(new Set());
  };

  const handleCountryClear = () => {
    setSelectedCountryIds(new Set());
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

      {/* Filter row: Country + Date + active badges */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Country multi-select */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium whitespace-nowrap">الدولة:</label>
          <CountryMultiSelect
            countries={countries}
            selectedIds={selectedCountryIds}
            mode={countryMode}
            onToggle={handleCountryToggle}
            onModeChange={handleCountryModeChange}
            onClear={handleCountryClear}
          />
        </div>

        {/* Visual separator */}
        <span className="hidden sm:block h-5 w-px bg-border" aria-hidden="true" />

        {/* Quick date presets */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">التاريخ:</span>
          <button
            type="button"
            onClick={() => handleDatePreset("today")}
            className={cn(
              "h-8 px-3 rounded-md border text-sm font-medium transition-colors",
              isToday
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input hover:bg-muted"
            )}
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => handleDatePreset("yesterday")}
            className={cn(
              "h-8 px-3 rounded-md border text-sm font-medium transition-colors",
              isYesterday
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input hover:bg-muted"
            )}
          >
            أمس
          </button>
        </div>

        {/* من تاريخ */}
        <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
          <PopoverTrigger
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
              dateFrom && !isToday && !isYesterday
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-muted"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateFrom ? format(new Date(dateFrom), "d MMM", { locale: arSA }) : "من تاريخ"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom ? new Date(dateFrom) : undefined}
              onDayClick={(d) => {
                setDateFrom(format(d, "yyyy-MM-dd"));
                setSelected(new Set());
                setDateFromOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {/* إلى تاريخ */}
        <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
          <PopoverTrigger
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
              dateTo && !isToday && !isYesterday
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-muted"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateTo ? format(new Date(dateTo), "d MMM", { locale: arSA }) : "إلى تاريخ"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo ? new Date(dateTo) : undefined}
              onDayClick={(d) => {
                setDateTo(format(d, "yyyy-MM-dd"));
                setSelected(new Set());
                setDateToOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {/* Active filter badges */}
        {hasDateFilter && (
          <button
            type="button"
            onClick={() => handleDatePreset("clear")}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            <CalendarIcon className="h-3 w-3" />
            {activeDateLabel}
            <X className="h-3 w-3" />
          </button>
        )}

        {selectedCountryIds.size > 0 && [...selectedCountryIds].map((id) => {
          const country = countries.find((c) => c.id === id);
          if (!country) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleCountryToggle(id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                countryMode === "exclude"
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "bg-primary/10 text-primary hover:bg-primary/20",
              )}
            >
              {countryMode === "exclude" && <span className="opacity-70">≠</span>}
              {country.name}
              <X className="h-3 w-3" />
            </button>
          );
        })}
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
      <div className="rounded-lg border overflow-clip">
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
              <TableHead className="sticky left-0 bg-muted/40"></TableHead>
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
                  <div className="space-y-1.5">
                    <p>لا توجد طلبات تطابق الفلاتر المحددة</p>
                    {(hasDateFilter || selectedCountryIds.size > 0 || activeTab !== "all") && (
                      <p className="text-xs flex flex-wrap justify-center gap-x-1">
                        <span>جرب:</span>
                        {hasDateFilter && (
                          <button
                            type="button"
                            onClick={() => handleDatePreset("clear")}
                            className="underline hover:text-foreground"
                          >
                            توسيع نطاق التاريخ
                          </button>
                        )}
                        {hasDateFilter && (selectedCountryIds.size > 0 || activeTab !== "all") && <span>·</span>}
                        {selectedCountryIds.size > 0 && (
                          <button
                            type="button"
                            onClick={handleCountryClear}
                            className="underline hover:text-foreground"
                          >
                            إلغاء فلتر الدولة
                          </button>
                        )}
                        {selectedCountryIds.size > 0 && activeTab !== "all" && <span>·</span>}
                        {activeTab !== "all" && (
                          <button
                            type="button"
                            onClick={() => handleTabChange("all")}
                            className="underline hover:text-foreground"
                          >
                            عرض كل الحالات
                          </button>
                        )}
                      </p>
                    )}
                  </div>
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
                    className="sticky left-0 z-10 bg-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type="button"
                      size="sm"
                      disabled={rowStatusLoading && statusTarget?.id === order.id}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStatusTarget(order); }}
                      className="gap-1 whitespace-nowrap transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
                    >
                      {rowStatusLoading && statusTarget?.id === order.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Truck className="h-3.5 w-3.5" />
                      )}
                      تحديث حالة الشحن
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Per-row status dialog */}
      {statusTarget && (
        <ShippingStatusDialog
          orderIds={[statusTarget.id]}
          statuses={shippingStatuses}
          companies={companies}
          open={!!statusTarget}
          loading={rowStatusLoading}
          onClose={() => { if (!rowStatusLoading) setStatusTarget(null); }}
          onSubmit={handleRowStatusSubmit}
        />
      )}

      {/* Bulk Shipping Status Dialog */}
      {bulkStatusOpen && (
        <ShippingStatusDialog
          orderIds={bulkSelectedIds}
          statuses={shippingStatuses}
          companies={companies}
          open={bulkStatusOpen}
          loading={bulkLoading}
          onClose={() => { if (!bulkLoading) setBulkStatusOpen(false); }}
          onSubmit={handleBulkStatusSubmit}
        />
      )}

    </div>
  );
}
