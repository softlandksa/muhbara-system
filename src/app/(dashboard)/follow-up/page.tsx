"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  MessageSquare, Search, Filter, X, CalendarIcon,
  ExternalLink, Loader2, Clock,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusItem = { id: string; name: string; color: string };

type FollowUpNote = {
  id: string;
  note: string;
  createdAt: string;
  createdBy: { id: string; name: string };
};

type FollowUpOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  phone: string;
  address: string;
  status: StatusItem;
  totalAmount: number;
  country: { id: string; name: string };
  currency: { id: string; code: string; symbol: string };
  createdBy: { id: string; name: string };
  items: { quantity: number; product: { id: string; name: string } }[];
  shippingInfo: {
    id: string;
    trackingNumber: string;
    shippedAt: string;
    shippingCompany: { id: string; name: string; trackingUrl: string | null };
  } | null;
  followUpNotes: FollowUpNote[];
};

// ─── Add Note Dialog (single order) ──────────────────────────────────────────

function NotesDialog({
  order,
  open,
  onClose,
}: {
  order: FollowUpOrder | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");

  const mutation = useMutation({
    mutationFn: async (note: string) => {
      if (!order) return;
      const res = await fetch(`/api/orders/${order.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل إضافة الملاحظة");
      return json.data;
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["follow-up-orders"] });
      toast.success("تمت إضافة الملاحظة");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!order) return null;

  const notes = order.followUpNotes;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            ملاحظات المتابعة — {order.orderNumber}
          </DialogTitle>
        </DialogHeader>

        {/* Order mini summary */}
        <div className="rounded-lg bg-muted px-3 py-2 text-sm space-y-1">
          <p className="font-medium">{order.customerName}</p>
          <p className="text-muted-foreground" dir="ltr">{order.phone}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
              {order.status.name}
            </Badge>
          </div>
        </div>

        {/* Previous notes */}
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا توجد ملاحظات بعد</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{note.createdBy.name}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(note.createdAt), "dd/MM/yyyy HH:mm", { locale: arSA })}
                  </span>
                </div>
                <p className="text-sm bg-muted rounded px-3 py-2">{note.note}</p>
              </div>
            ))
          )}
        </div>

        <Separator />

        {/* Add note */}
        <div className="space-y-2">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="أضف ملاحظة جديدة..."
            rows={3}
            className="text-sm"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          <Button
            onClick={() => mutation.mutate(noteText)}
            disabled={!noteText.trim() || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : null}
            إضافة ملاحظة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Note Dialog ─────────────────────────────────────────────────────────

function BulkNoteDialog({
  orderIds,
  open,
  onClose,
  onDone,
}: {
  orderIds: string[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const handleClose = () => {
    if (loading) return;
    setNoteText("");
    setProgress({ done: 0, total: 0 });
    onClose();
  };

  const handleSubmit = async () => {
    if (!noteText.trim()) return;
    setLoading(true);
    setProgress({ done: 0, total: orderIds.length });
    let succeeded = 0;
    for (let i = 0; i < orderIds.length; i++) {
      try {
        const res = await fetch(`/api/orders/${orderIds[i]}/follow-up`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: noteText.trim() }),
        });
        if (res.ok) succeeded++;
      } catch {
        // continue even if one fails
      }
      setProgress({ done: i + 1, total: orderIds.length });
    }
    toast.success(`تمت إضافة الملاحظة لـ ${succeeded} طلب`);
    setLoading(false);
    setNoteText("");
    setProgress({ done: 0, total: 0 });
    onDone();
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة ملاحظة لـ {orderIds.length} طلب</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="اكتب الملاحظة..."
            rows={4}
          />
          {loading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>جار الإضافة...</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={!noteText.trim() || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
            إضافة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function FollowUpPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<FollowUpOrder | null>(null);

  // Bulk selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNoteOpen, setBulkNoteOpen] = useState(false);

  const statusParams = searchParams.getAll("status");
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput) params.set("search", searchInput);
      else params.delete("search");
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, pathname, router]
  );

  const { data: statusesData } = useQuery<{ data: StatusItem[] }>({
    queryKey: ["shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const statuses = statusesData?.data ?? [];

  const toggleStatus = useCallback(
    (s: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const current = params.getAll("status");
      if (current.includes(s)) {
        params.delete("status");
        current.filter((x) => x !== s).forEach((x) => params.append("status", x));
      } else {
        params.append("status", s);
      }
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, pathname, router]
  );

  const queryStr = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: FollowUpOrder[] }>({
    queryKey: ["follow-up-orders", queryStr],
    queryFn: () => fetch(`/api/follow-up?${queryStr}`).then((r) => r.json()),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const orders = data?.data ?? [];
  const hasActiveFilters = statusParams.length > 0 || dateFrom || dateTo;

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("dateFrom");
    params.delete("dateTo");
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Selection helpers
  const allIds = orders.map((o) => o.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">لوحة المتابعة</h1>
        <Badge variant="secondary">{orders.length} طلب</Badge>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pr-9"
            placeholder="بحث برقم الطلب أو اسم العميل أو الجوال..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

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
          <PopoverContent className="w-72 p-4 space-y-4" align="end">
            <div className="space-y-2">
              <Label className="text-sm font-medium">الحالة</Label>
              <div className="space-y-2">
                {statuses.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`fu-status-${s.id}`}
                      checked={statusParams.includes(s.id)}
                      onCheckedChange={() => toggleStatus(s.id)}
                    />
                    <label htmlFor={`fu-status-${s.id}`} className="text-sm cursor-pointer">
                      {s.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">من تاريخ</Label>
              <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{dateFrom || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateFrom ? new Date(dateFrom) : undefined}
                    onDayClick={(d) => {
                      updateParam("dateFrom", format(d, "yyyy-MM-dd"));
                      setDateFromOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">إلى تاريخ</Label>
              <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm">
                  <span>{dateTo || "اختر تاريخاً"}</span>
                  <CalendarIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateTo ? new Date(dateTo) : undefined}
                    onDayClick={(d) => {
                      updateParam("dateTo", format(d, "yyyy-MM-dd"));
                      setDateToOpen(false);
                    }}
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkNoteOpen(true)}
              className="gap-1"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              إضافة ملاحظة للمحدد ({selected.size})
            </Button>
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
              <TableHead>رقم التتبع</TableHead>
              <TableHead>الملاحظات</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                  لا توجد طلبات
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow
                  key={order.id}
                  className={cn("hover:bg-muted/40", selected.has(order.id) && "bg-blue-50/50")}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(order.id)}
                      onCheckedChange={() => toggleOne(order.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      className="font-mono text-sm text-primary hover:underline"
                      onClick={() => router.push(`/orders/${order.id}`)}
                    >
                      {order.orderNumber}
                    </button>
                  </TableCell>
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
                  <TableCell>
                    <span className="font-medium">{order.totalAmount.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground mr-1">{order.currency.code}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
                      {order.status.name}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {order.shippingInfo ? (
                      <div className="flex items-center gap-1" dir="ltr">
                        <span className="font-mono text-xs">{order.shippingInfo.trackingNumber}</span>
                        {order.shippingInfo.shippingCompany.trackingUrl && (
                          <a
                            href={order.shippingInfo.shippingCompany.trackingUrl.replace(
                              "{tracking}",
                              order.shippingInfo.trackingNumber
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{order.followUpNotes.length}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      متابعة
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Single order notes dialog */}
      <NotesDialog
        order={selectedOrder}
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />

      {/* Bulk note dialog */}
      <BulkNoteDialog
        orderIds={Array.from(selected)}
        open={bulkNoteOpen}
        onClose={() => setBulkNoteOpen(false)}
        onDone={() => {
          setBulkNoteOpen(false);
          setSelected(new Set());
          queryClient.invalidateQueries({ queryKey: ["follow-up-orders"] });
        }}
      />
    </div>
  );
}

export default function FollowUpPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <FollowUpPageInner />
    </Suspense>
  );
}
