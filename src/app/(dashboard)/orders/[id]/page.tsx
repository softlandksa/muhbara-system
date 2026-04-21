"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  ArrowRight, Loader2, MessageSquare, Package, MapPin, Phone,
  CreditCard, Truck, Clock, FileText, Trash2, RefreshCw, Pencil, Receipt,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ShippingStatusDialog } from "@/components/shared/ShippingStatusDialog";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditLog = {
  id: string;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
  changedBy: { id: string; name: string };
};

type FollowUpNote = {
  id: string;
  note: string;
  createdAt: string;
  createdBy: { id: string; name: string };
};

type ShippingCompany = { id: string; name: string; trackingUrl: string | null };
type ShippingStatusSub = {
  id: string;
  name: string;
  colorOverride: string | null;
  marksOrderDelivered: boolean;
};
type ShippingStatusItem = {
  id: string; name: string; color: string; sortOrder: number; subs: ShippingStatusSub[];
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  phone: string;
  address: string;
  status: { id: string; name: string; color: string };
  totalAmount: number;
  notes: string | null;
  isRepeatCustomer: boolean;
  repeatCustomerNote: string | null;
  country: { id: string; name: string };
  currency: { id: string; code: string; symbol: string };
  paymentMethod: { id: string; name: string };
  createdBy: { id: string; name: string; email: string; role: string };
  createdAt: string;
  team: { id: string; name: string } | null;
  paymentReceiptUrl: string | null;
  paymentReceiptMime: string | null;
  paymentReceiptUploadedAt: string | null;
  items: {
    id: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    product: { id: string; name: string };
  }[];
  shippingInfo: {
    id: string;
    trackingNumber: string | null;
    shippedAt: string;
    deliveredAt: string | null;
    notes: string | null;
    shippingCompany: { id: string; name: string; trackingUrl: string | null };
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

// ─── Constants ────────────────────────────────────────────────────────────────

// Maps each role to the action buttons it may see on the order detail page.
const ROLE_ACTIONS: Record<string, string[]> = {
  ADMIN:    ["edit", "delete", "ship", "comment"],
  SHIPPING: ["edit", "delete", "ship", "comment"],
  SALES:    ["edit"],
  FOLLOWUP: ["comment"],
};

const ACTION_LABELS: Record<string, string> = {
  CREATE:                  "إنشاء الطلب",
  UPDATE:                  "تعديل بيانات الطلب",
  STATUS_CHANGE:           "تغيير الحالة",
  SHIPPING_STATUS_UPDATE:  "تحديث حالة الشحن",
  NOTE_ADDED:              "تعليق على الطلب",
  FIELD_UPDATE:            "تحديث حقل",
  IMPORT_ORDER:            "استيراد طلب",
  SHIP_ORDER:              "شحن الطلب",
  RECEIPT_UPLOADED:        "تم رفع إيصال سداد",
};

const FIELD_LABELS: Record<string, string> = {
  customerName:    "اسم العميل",
  phone:           "رقم الجوال",
  address:         "العنوان",
  orderDate:       "تاريخ الطلب",
  status:          "حالة الطلب",
  shippingStatus:  "حالة الشحن",
  countryId:       "الدولة",
  currencyId:      "العملة",
  paymentMethodId: "طريقة الدفع",
  notes:           "الملاحظات",
};

// ─── Timeline Item ────────────────────────────────────────────────────────────

type TimelineEntry =
  | { type: "audit"; data: AuditLog }
  | { type: "note"; data: FollowUpNote };

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const date = entry.type === "audit"
    ? new Date(entry.data.changedAt)
    : new Date(entry.data.createdAt);
  const author = entry.type === "audit" ? entry.data.changedBy.name : entry.data.createdBy.name;

  const isNote = entry.type === "note";

  return (
    <div className="flex gap-3">
      <div className={cn(
        "mt-1 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white",
        isNote ? "bg-purple-500" : "bg-primary/80"
      )}>
        {isNote ? <MessageSquare className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {isNote ? "تعليق على الطلب" : ACTION_LABELS[entry.data.action] ?? entry.data.action}
          </span>
          <Tooltip>
            <TooltipTrigger className="text-xs text-muted-foreground whitespace-nowrap cursor-default">
              {formatDistanceToNow(date, { locale: arSA, addSuffix: true })}
            </TooltipTrigger>
            <TooltipContent>
              {format(date, "dd/MM/yyyy HH:mm", { locale: arSA })}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">{author}</span>
          {" · "}
          <span>{format(date, "dd/MM/yyyy HH:mm", { locale: arSA })}</span>
        </p>
        {isNote && (
          <p className="mt-1 text-sm bg-muted rounded-md px-3 py-2">{(entry.data as FollowUpNote).note}</p>
        )}
        {!isNote && (entry.data as AuditLog).fieldName && (
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-medium">
              {FIELD_LABELS[(entry.data as AuditLog).fieldName!] ?? (entry.data as AuditLog).fieldName}
            </span>
            {": "}
            {(entry.data as AuditLog).oldValue && (
              <span className="line-through text-destructive/70">{(entry.data as AuditLog).oldValue}</span>
            )}
            {(entry.data as AuditLog).oldValue && (entry.data as AuditLog).newValue && " ← "}
            {(entry.data as AuditLog).newValue && (
              <span className="text-green-600">{(entry.data as AuditLog).newValue}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusDialogLoading, setStatusDialogLoading] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Clean up any residual body styles left by @base-ui/react after dialog close.
  const anyDialogOpen = deleteOpen || statusDialogOpen;
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
  const userId = session?.user?.id;

  const { data: order, isLoading: orderLoading } = useQuery<OrderDetail>({
    queryKey: ["order", id],
    queryFn: () => fetch(`/api/orders/${id}`).then((r) => r.json()).then((r) => r.data),
    enabled: !!id,
  });

  const { data: auditLogs = [] } = useQuery<AuditLog[]>({
    queryKey: ["order-audit", id],
    queryFn: () => fetch(`/api/orders/${id}/audit-log`).then((r) => r.json()).then((r) => r.data),
    enabled: !!id,
  });

  const { data: followUpNotes = [] } = useQuery<FollowUpNote[]>({
    queryKey: ["order-followup", id],
    queryFn: () => fetch(`/api/orders/${id}/follow-up`).then((r) => r.json()).then((r) => r.data),
    enabled: !!id,
  });

  const canShip = role === "ADMIN" || role === "SHIPPING";

  const { data: shippingCompanies = [] } = useQuery<ShippingCompany[]>({
    queryKey: ["lookup-shipping-companies"],
    queryFn: () => fetch("/api/lookup/shipping-companies").then((r) => r.json()).then((r) => r.data),
    enabled: canShip,
    staleTime: 5 * 60_000,
  });

  const { data: shippingStatuses = [] } = useQuery<ShippingStatusItem[]>({
    queryKey: ["lookup-shipping-statuses"],
    queryFn: () => fetch("/api/lookup/shipping-statuses").then((r) => r.json()).then((r) => r.data),
    enabled: canShip,
    staleTime: 5 * 60_000,
  });

  // ── Merge timeline ──
  // NOTE_ADDED audit entries are filtered out — notes already appear as dedicated "note" entries
  // from the followUpNotes query, so showing them twice would create duplicates.
  const timeline: TimelineEntry[] = [
    ...auditLogs.filter((d) => d.action !== "NOTE_ADDED").map((d): TimelineEntry => ({ type: "audit", data: d })),
    ...followUpNotes.map((d): TimelineEntry => ({ type: "note", data: d })),
  ].sort((a, b) => {
    const aDate = a.type === "audit" ? new Date(a.data.changedAt) : new Date(a.data.createdAt);
    const bDate = b.type === "audit" ? new Date(b.data.changedAt) : new Date(b.data.createdAt);
    return aDate.getTime() - bDate.getTime();
  });

  // ── Delete order mutation ──
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? "فشل الحذف"); }
    },
    onSuccess: () => { toast.success("تم حذف الطلب"); router.replace("/orders"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Add note mutation ──
  const noteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await fetch(`/api/orders/${id}/follow-up`, {
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
      setNoteExpanded(false);
      queryClient.invalidateQueries({ queryKey: ["order-followup", id] });
      queryClient.invalidateQueries({ queryKey: ["order-audit", id] });
      toast.success("تمت إضافة الملاحظة");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleShippingStatusSubmit = async (
    subStatusId: string,
    shippingCompanyId?: string,
    trackingNumber?: string,
  ) => {
    setStatusDialogLoading(true);
    try {
      const res = await fetch("/api/shipping/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: [id],
          subStatusId,
          ...(shippingCompanyId && { shippingCompanyId }),
          ...(trackingNumber?.trim() && { trackingNumber: trackingNumber.trim() }),
        }),
      });
      const json: { data?: { updatedCount: number; errors: { orderId: string; message: string }[] }; error?: string } =
        await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "فشل تحديث حالة الشحن");
        return;
      }
      const firstError = json.data?.errors?.[0];
      if (firstError) {
        toast.error(firstError.message);
        return;
      }
      toast.success("تم تحديث حالة الشحن");
      setStatusDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["order-audit", id] });
      queryClient.invalidateQueries({ queryKey: ["shipping-all"] });
    } catch {
      toast.error("حدث خطأ في الاتصال");
    } finally {
      setStatusDialogLoading(false);
    }
  };

  if (orderLoading) {
    return (
      <div className="p-6 space-y-4" dir="rtl">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-muted-foreground">الطلب غير موجود</p>
        <Button variant="link" onClick={() => router.push("/orders")}>العودة للطلبات</Button>
      </div>
    );
  }

  const visibleActions = new Set(role ? (ROLE_ACTIONS[role] ?? []) : []);
  const canEdit    = visibleActions.has("edit") &&
                     (role !== "SALES" || (userId === order.createdBy.id && order.status.name === "جاهز للشحن"));
  const canDelete  = visibleActions.has("delete");
  const canAddNote = visibleActions.has("comment");

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{order.orderNumber}</h1>
            <Badge variant="outline" className="text-sm border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
              {order.status.name}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground/60">تاريخ الطلب:</span>
              <span className="font-semibold text-foreground">
                {format(new Date(order.orderDate), "EEEE، dd MMMM yyyy", { locale: arSA })}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground/60">أُدخل في النظام:</span>
              <span>{format(new Date(order.createdAt), "dd/MM/yyyy HH:mm", { locale: arSA })}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground/60">أضافه:</span>
              <span className="font-medium text-foreground">{order.createdBy.name}</span>
              <span className="text-muted-foreground/60">
                ({ROLE_LABELS[order.createdBy.role as keyof typeof ROLE_LABELS] ?? order.createdBy.role})
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 border-blue-500/40 text-blue-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-500/70 dark:text-blue-400 dark:border-blue-500/40 dark:hover:bg-blue-950 transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
              onClick={() => router.push(`/orders/${id}/edit`)}
            >
              <Pencil className="h-4 w-4" />
              تعديل الطلب
            </Button>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive border-destructive/30 transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                بيانات العميل
                {order.isRepeatCustomer && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 border border-orange-200">
                    <RefreshCw className="h-3 w-3" />
                    عميل مكرر
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">الاسم</p>
                <p className="font-medium">{order.customerName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">الجوال</p>
                <p className="font-medium font-mono" dir="ltr">{order.phone}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> العنوان</p>
                <p className="font-medium">{order.address}</p>
              </div>
              <div>
                <p className="text-muted-foreground">الدولة</p>
                <p className="font-medium">{order.country.name}</p>
              </div>
              {order.isRepeatCustomer && (
                <div className="col-span-2">
                  <p className="text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> ملاحظة التكرار
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                    <p className="text-sm text-orange-800">{order.repeatCustomerNote ?? "عميل مكرر"}</p>
                    <a
                      href={`/orders?search=${encodeURIComponent(order.phone)}`}
                      className="shrink-0 text-xs text-primary hover:underline font-medium"
                    >
                      عرض طلباته السابقة
                    </a>
                  </div>
                </div>
              )}
              {order.team && (
                <div>
                  <p className="text-muted-foreground">الفريق</p>
                  <p className="font-medium">{order.team.name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                معلومات الطلب
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">العملة</p>
                <p className="font-medium">{order.currency.code}</p>
              </div>
              <div>
                <p className="text-muted-foreground">طريقة الدفع</p>
                <p className="font-medium">{order.paymentMethod.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">الإجمالي</p>
                <p className="font-bold text-lg">{order.totalAmount.toFixed(2)} {order.currency.code}</p>
              </div>
              {order.paymentReceiptUrl && (
                <div className="col-span-2">
                  <p className="text-muted-foreground flex items-center gap-1 mb-1"><Receipt className="h-3 w-3" /> إيصال السداد</p>
                  <a
                    href={`/api/orders/${order.id}/receipt`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <Receipt className="h-4 w-4" />
                    عرض إيصال السداد
                  </a>
                </div>
              )}
              {order.notes && (
                <div className="col-span-2">
                  <p className="text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" /> ملاحظات</p>
                  <p className="mt-1 text-sm bg-muted rounded px-3 py-2">{order.notes}</p>
                </div>
              )}
              <Separator className="col-span-2" />
              <div>
                <p className="text-muted-foreground">تاريخ الطلب</p>
                <p className="font-medium">{format(new Date(order.orderDate), "dd/MM/yyyy", { locale: arSA })}</p>
                <p className="text-xs text-muted-foreground">التاريخ التجاري للطلب</p>
              </div>
              <div>
                <p className="text-muted-foreground">تاريخ الإضافة للنظام</p>
                <p className="font-medium">{format(new Date(order.createdAt), "dd/MM/yyyy HH:mm", { locale: arSA })}</p>
                <p className="text-xs text-muted-foreground">وقت تسجيل الطلب في النظام</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">أضافه / المستخدم المُدخل</p>
                <p className="font-medium">
                  {order.createdBy.name}
                  <span className="text-muted-foreground font-normal mr-1">
                    — {ROLE_LABELS[order.createdBy.role as keyof typeof ROLE_LABELS] ?? order.createdBy.role}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground" dir="ltr">{order.createdBy.email}</p>
              </div>
            </CardContent>
          </Card>

          {/* Items Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                المنتجات
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنتج</TableHead>
                    <TableHead className="text-center">الكمية</TableHead>
                    <TableHead className="text-end">السعر</TableHead>
                    <TableHead className="text-end">الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.product.name}</TableCell>
                      <TableCell className="text-center">{item.quantity}</TableCell>
                      <TableCell className="text-end">{item.unitPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-end font-medium">{item.totalPrice.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="text-end font-semibold">الإجمالي</TableCell>
                    <TableCell className="text-end font-bold text-lg">{order.totalAmount.toFixed(2)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Shipping Info */}
          {order.shippingInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  معلومات الشحن
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">شركة الشحن</p>
                  <p className="font-medium">{order.shippingInfo.shippingCompany.name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">رقم التتبع</p>
                  {order.shippingInfo.trackingNumber ? (
                    order.shippingInfo.shippingCompany.trackingUrl ? (
                      <a
                        href={order.shippingInfo.shippingCompany.trackingUrl.replace("{tracking}", order.shippingInfo.trackingNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary hover:underline font-mono"
                      >
                        {order.shippingInfo.trackingNumber}
                      </a>
                    ) : (
                      <p className="font-medium font-mono">{order.shippingInfo.trackingNumber}</p>
                    )
                  ) : (
                    <p className="text-muted-foreground">—</p>
                  )}
                </div>
                {order.shippingInfo.shippingSubStatus && (
                  <div>
                    <p className="text-muted-foreground">حالة الشحن</p>
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border"
                      style={{
                        backgroundColor: (order.shippingInfo.shippingSubStatus.colorOverride ?? order.shippingInfo.shippingSubStatus.primary.color) + "22",
                        color: order.shippingInfo.shippingSubStatus.colorOverride ?? order.shippingInfo.shippingSubStatus.primary.color,
                        borderColor: (order.shippingInfo.shippingSubStatus.colorOverride ?? order.shippingInfo.shippingSubStatus.primary.color) + "55",
                      }}
                    >
                      {order.shippingInfo.shippingSubStatus.name}
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">حالة الطلب</p>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border" style={{ backgroundColor: order.status.color + "22", color: order.status.color, borderColor: order.status.color + "55" }}>
                    {order.status.name}
                  </span>
                </div>
                <div>
                  <p className="text-muted-foreground">تاريخ الشحن</p>
                  <p className="font-medium">{format(new Date(order.shippingInfo.shippedAt), "dd/MM/yyyy", { locale: arSA })}</p>
                </div>
                {order.shippingInfo.deliveredAt && (
                  <div>
                    <p className="text-muted-foreground">تاريخ التسليم</p>
                    <p className="font-medium">{format(new Date(order.shippingInfo.deliveredAt), "dd/MM/yyyy", { locale: arSA })}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">شُحن بواسطة</p>
                  <p className="font-medium">{order.shippingInfo.shippedBy.name}</p>
                </div>
                {order.shippingInfo.notes && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">ملاحظات الشحن</p>
                    <p className="mt-1 bg-muted rounded px-3 py-2">{order.shippingInfo.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-4">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                السجل والمتابعة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* ── Action buttons ──────────────────────────────────── */}
              <div className="space-y-2">
                {canShip && (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full gap-1.5 transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
                    onClick={(e) => { e.preventDefault(); setStatusDialogOpen(true); }}
                  >
                    <Truck className="h-3.5 w-3.5" />
                    تحديث حالة الشحن
                  </Button>
                )}
                {canAddNote && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 border-violet-500/40 text-violet-600 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-500/70 dark:text-violet-400 dark:border-violet-500/40 dark:hover:bg-violet-950 transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
                    onClick={() => {
                      setNoteExpanded(true);
                      setTimeout(() => noteRef.current?.focus(), 50);
                    }}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    تعليق على الطلب
                  </Button>
                )}
              </div>

              {/* ── Inline note form (revealed on demand) ───────────── */}
              {canAddNote && noteExpanded && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Textarea
                      ref={noteRef}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="أضف ملاحظة متابعة..."
                      rows={3}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
                        disabled={noteMutation.isPending}
                        onClick={() => { setNoteExpanded(false); setNoteText(""); }}
                      >
                        إلغاء
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1 transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
                        disabled={!noteText.trim() || noteMutation.isPending}
                        onClick={() => noteMutation.mutate(noteText)}
                      >
                        {noteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
                        إضافة ملاحظة
                      </Button>
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* ── Timeline ────────────────────────────────────────── */}
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">لا يوجد سجل بعد</p>
                ) : (
                  timeline.map((entry) => (
                    <TimelineItem
                      key={entry.type === "audit" ? `a-${entry.data.id}` : `n-${entry.data.id}`}
                      entry={entry}
                    />
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="حذف الطلب"
        description={`هل أنت متأكد من حذف الطلب ${order.orderNumber}؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmLabel="حذف الطلب"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

      {/* Shipping status dialog — same component/API as shipping board single-order flow */}
      {statusDialogOpen && (
        <ShippingStatusDialog
          orderIds={[order.id]}
          statuses={shippingStatuses}
          companies={shippingCompanies}
          open={statusDialogOpen}
          loading={statusDialogLoading}
          requiresCompany={!order.shippingInfo}
          onClose={() => { if (!statusDialogLoading) setStatusDialogOpen(false); }}
          onSubmit={handleShippingStatusSubmit}
        />
      )}
    </div>
  );
}
