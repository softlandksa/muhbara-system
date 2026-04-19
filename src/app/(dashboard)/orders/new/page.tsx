"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import {
  CalendarIcon, Plus, Trash2, Loader2, ArrowRight,
  AlertTriangle, CheckCircle2, AlertCircle, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { cn } from "@/lib/utils";
import { AppLoadingOverlay } from "@/components/shared/AppLoadingOverlay";

// ─── Schema ──────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  quantity: z.number().int().min(1, "الكمية يجب أن تكون على الأقل 1"),
  lineTotal: z.number().min(0, "المبلغ لا يمكن أن يكون سالباً"),
});

const orderSchema = z.object({
  orderDate: z.date(),
  customerName: z.string().min(1, "اسم العميل مطلوب"),
  phone: z.string().min(1, "رقم الجوال مطلوب"),
  address: z.string().min(1, "العنوان مطلوب"),
  countryId: z.string().min(1, "الدولة مطلوبة"),
  currencyId: z.string().min(1, "العملة مطلوبة"),
  paymentMethodId: z.string().min(1, "طريقة الدفع مطلوبة"),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1, "يجب إضافة منتج واحد على الأقل"),
});

type OrderFormData = z.infer<typeof orderSchema>;

// ─── Types ────────────────────────────────────────────────────────────────────

type LookupItem = { id: string; name: string };
type CurrencyItem = { id: string; name: string; symbol: string; code: string };
type CountryItem = { id: string; name: string; phoneFormat: string | null; phoneCode: string | null };
type Product = { id: string; name: string; sku: string | null; defaultPrice: number };

type ExistingOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: { id: string; name: string; color: string };
  totalAmount: number;
  country: { name: string };
  currency: { code: string };
  items: { product: { name: string }; quantity: number }[];
};

type DupState = {
  loading: boolean;
  checked: boolean;
  isDuplicate: boolean;
  existingOrders: ExistingOrder[];
  nameMatches: ExistingOrder[];
};

// ─── Duplicate Alert Component ────────────────────────────────────────────────

function DuplicateAlert({
  dupState,
  dupAcknowledged,
  onContinue,
  onCancel,
}: {
  dupState: DupState;
  dupAcknowledged: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  if (dupState.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>جاري التحقق من التكرار...</span>
      </div>
    );
  }

  if (!dupState.checked) return null;

  // Phone duplicate found and not yet acknowledged
  if (dupState.isDuplicate && !dupAcknowledged) {
    return (
      <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-orange-900 text-sm">
              تنبيه: هذا العميل لديه طلبات سابقة
            </p>
            <p className="text-xs text-orange-700 mt-0.5">
              تم العثور على {dupState.existingOrders.length} طلب بنفس رقم الجوال
            </p>
          </div>
        </div>

        {/* Mini orders table */}
        <div className="overflow-x-auto rounded border border-orange-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-orange-50">
              <tr className="border-b border-orange-200">
                <th className="text-right py-1.5 px-2 font-medium">رقم الطلب</th>
                <th className="text-right py-1.5 px-2 font-medium">التاريخ</th>
                <th className="text-right py-1.5 px-2 font-medium">المنتج</th>
                <th className="text-right py-1.5 px-2 font-medium">المبلغ</th>
                <th className="text-right py-1.5 px-2 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {dupState.existingOrders.slice(0, 5).map((order) => (
                <tr key={order.id} className="border-b border-orange-100 last:border-0">
                  <td className="py-1.5 px-2 font-mono text-orange-800">{order.orderNumber}</td>
                  <td className="py-1.5 px-2 text-gray-600">
                    {format(new Date(order.orderDate), "dd/MM/yy", { locale: arSA })}
                  </td>
                  <td className="py-1.5 px-2 text-gray-700 max-w-[120px] truncate">
                    {order.items[0]?.product.name ?? "—"}
                    {order.items.length > 1 && ` +${order.items.length - 1}`}
                  </td>
                  <td className="py-1.5 px-2 font-medium text-gray-800">
                    {order.totalAmount.toFixed(0)} {order.currency.code}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700">
                      {order.status.name}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            onClick={onContinue}
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            طلب جديد — متابعة التسجيل
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={onCancel}
            className="gap-1.5"
          >
            إلغاء — الطلب مكرر
          </Button>
          <a
            href={`/orders?search=${dupState.existingOrders[0]?.orderNumber?.slice(0, 3) ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-orange-700 hover:underline mt-auto"
          >
            <ExternalLink className="h-3 w-3" />
            عرض الطلبات السابقة
          </a>
        </div>
      </div>
    );
  }

  // Acknowledged repeat customer
  if (dupState.isDuplicate && dupAcknowledged) {
    return (
      <div className="flex items-center gap-2 text-sm py-1">
        <Badge className="bg-orange-100 text-orange-800 border-orange-200 gap-1 hover:bg-orange-100">
          <AlertTriangle className="h-3 w-3" />
          عميل مكرر — سيتم حفظ الطلب مع إشارة التكرار
        </Badge>
      </div>
    );
  }

  // Name match only (different phone)
  if (!dupState.isDuplicate && dupState.nameMatches.length > 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
        <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
        <p className="text-xs text-yellow-800">
          يوجد عميل بنفس الاسم برقم مختلف ({dupState.nameMatches.length} طلب) — هل هو نفس الشخص؟
        </p>
      </div>
    );
  }

  // Clean — new customer
  return (
    <div className="flex items-center gap-1.5 text-sm text-green-600 py-1">
      <CheckCircle2 className="h-4 w-4" />
      <span>عميل جديد ✓</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewOrderPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [dateOpen, setDateOpen] = useState(false);

  // ── Duplicate detection state ──
  const [dupState, setDupState] = useState<DupState>({
    loading: false, checked: false, isDuplicate: false,
    existingOrders: [], nameMatches: [],
  });
  const [dupAcknowledged, setDupAcknowledged] = useState(false);
  const [isRepeatCustomer, setIsRepeatCustomer] = useState(false);
  const [repeatCustomerNote, setRepeatCustomerNote] = useState<string | undefined>();
  const dupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const role = session?.user?.role;

  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<OrderFormData>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      orderDate: new Date(),
      items: [{ productId: "", quantity: 1, lineTotal: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  // useWatch ensures reactive re-renders when any item field changes
  const watchedItems = useWatch({ control, name: "items" });
  const phoneValue = watch("phone") ?? "";
  const customerNameValue = watch("customerName") ?? "";
  const selectedCountryId = watch("countryId") ?? "";

  // ── Real-time duplicate detection ──
  useEffect(() => {
    // Reset when phone changes
    setDupAcknowledged(false);
    setIsRepeatCustomer(false);
    setRepeatCustomerNote(undefined);

    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);

    if (phoneValue.length < 6) {
      setDupState({ loading: false, checked: false, isDuplicate: false, existingOrders: [], nameMatches: [] });
      return;
    }

    setDupState((prev) => ({ ...prev, loading: true, checked: false }));

    dupTimerRef.current = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({
          phone: phoneValue,
          customerName: customerNameValue,
        });
        const res = await fetch(`/api/orders/check-duplicate?${qs}`);
        const json = await res.json();
        setDupState({
          loading: false,
          checked: true,
          isDuplicate: json.isDuplicate ?? false,
          existingOrders: json.existingOrders ?? [],
          nameMatches: json.nameMatches ?? [],
        });
      } catch {
        setDupState((prev) => ({ ...prev, loading: false, checked: false }));
      }
    }, 600);

    return () => {
      if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    };
  }, [phoneValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also re-run name check when customer name changes (debounced separately)
  useEffect(() => {
    if (!dupState.checked || !phoneValue || phoneValue.length < 6) return;
    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    dupTimerRef.current = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ phone: phoneValue, customerName: customerNameValue });
        const res = await fetch(`/api/orders/check-duplicate?${qs}`);
        const json = await res.json();
        setDupState({
          loading: false, checked: true,
          isDuplicate: json.isDuplicate ?? false,
          existingOrders: json.existingOrders ?? [],
          nameMatches: json.nameMatches ?? [],
        });
      } catch { /* silent */ }
    }, 800);
    return () => { if (dupTimerRef.current) clearTimeout(dupTimerRef.current); };
  }, [customerNameValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lookups ──
  const { data: countries = [] } = useQuery<CountryItem[]>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()).then((r) => r.data),
  });

  // Derive phone placeholder from selected country's phoneFormat
  const selectedCountry = countries.find((c) => c.id === selectedCountryId);
  const phonePlaceholder = selectedCountry?.phoneFormat ?? "5XXXXXXXX";
  const { data: currencies = [] } = useQuery<CurrencyItem[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () => fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => r.data),
  });

  // Derive currency symbol from selected currency
  const selectedCurrencyId = watch("currencyId") ?? "";
  const selectedCurrency = currencies.find((c) => c.id === selectedCurrencyId);
  const currencySymbol = selectedCurrency?.symbol ?? "";
  const { data: paymentMethods = [] } = useQuery<LookupItem[]>({
    queryKey: ["lookup-payment-methods"],
    queryFn: () => fetch("/api/lookup/payment-methods").then((r) => r.json()).then((r) => r.data),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["lookup-products"],
    queryFn: () => fetch("/api/lookup/products").then((r) => r.json()).then((r) => r.data),
  });

  // ── Preview order number ──
  const { data: numberData } = useQuery<{ orderNumber: string }>({
    queryKey: ["order-number-preview"],
    queryFn: () => fetch("/api/orders/number").then((r) => r.json()).then((r) => r.data),
  });

  // ── Grand total ──
  const total = useMemo(() => {
    return watchedItems.reduce((sum, item) => {
      return sum + (typeof item.lineTotal === "number" ? item.lineTotal : 0);
    }, 0);
  }, [watchedItems]);

  // ── Mutation ──
  const mutation = useMutation({
    mutationFn: async (data: OrderFormData) => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          orderDate: data.orderDate.toISOString(),
          isRepeatCustomer,
          repeatCustomerNote,
        }),
      });
      let json: { data?: { id: string }; error?: string } = {};
      try {
        json = await res.json();
      } catch {
        throw new Error(`خطأ في الخادم (${res.status})`);
      }
      if (!res.ok) throw new Error(json.error ?? "فشل إنشاء الطلب");
      return json.data;
    },
    onSuccess: (order) => {
      toast.success("تم إنشاء الطلب بنجاح");
      if (order?.id) router.push(`/orders/${order.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSubmit = (data: OrderFormData) => mutation.mutate(data);

  const orderDate = watch("orderDate");

  // Block submission when duplicate found but not acknowledged
  const submitBlocked = dupState.isDuplicate && !dupAcknowledged;

  // Permission guard — after ALL hooks
  if (role && role !== "ADMIN" && role !== "SALES") {
    router.replace("/orders");
    return null;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" dir="rtl">
      <AppLoadingOverlay open={mutation.isPending} message="جاري حفظ الطلب..." />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">إنشاء طلب جديد</h1>
          {numberData?.orderNumber && (
            <p className="text-sm text-muted-foreground">رقم الطلب: {numberData.orderNumber}</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Customer Info */}
        <Card>
          <CardHeader>
            <CardTitle>بيانات العميل والطلب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Row 1: اسم العميل | رقم الجوال | الدولة */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Customer Name */}
              <div className="space-y-1.5">
                <Label>اسم العميل</Label>
                <Input
                  {...register("customerName")}
                  placeholder="الاسم الكامل"
                  className={errors.customerName ? "border-destructive" : ""}
                />
                {errors.customerName && <p className="text-xs text-destructive">{errors.customerName.message}</p>}
              </div>

              {/* Phone — with duplicate check */}
              <div className="space-y-1.5">
                <Label>رقم الجوال</Label>
                <Input
                  {...register("phone")}
                  placeholder={phonePlaceholder}
                  dir="ltr"
                  onChange={(e) => {
                    // Always strip leading zeros in real-time
                    const stripped = e.target.value.replace(/^0+/, "");
                    setValue("phone", stripped, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                  }}
                  className={cn(
                    errors.phone ? "border-destructive" : "",
                    dupState.checked && !dupState.isDuplicate && dupState.existingOrders.length === 0 && dupState.nameMatches.length === 0
                      ? "border-green-400 focus:border-green-500"
                      : "",
                    dupState.isDuplicate && !dupAcknowledged ? "border-orange-400 focus:border-orange-500" : ""
                  )}
                />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>

              {/* Country */}
              <div className="space-y-1.5">
                <Label>الدولة</Label>
                <SearchableSelect
                  options={countries.map((c) => ({ value: c.id, label: c.name }))}
                  value={watch("countryId") ?? ""}
                  onChange={(v) => setValue("countryId", v, { shouldValidate: true })}
                  placeholder="اختر الدولة"
                  error={!!errors.countryId}
                />
                {errors.countryId && <p className="text-xs text-destructive">{errors.countryId.message}</p>}
              </div>
            </div>

            {/* Duplicate Alert (full width below row 1) */}
            <DuplicateAlert
              dupState={dupState}
              dupAcknowledged={dupAcknowledged}
              onContinue={() => {
                setDupAcknowledged(true);
                setIsRepeatCustomer(true);
                setRepeatCustomerNote(
                  `عميل مكرر — لديه ${dupState.existingOrders.length} طلبات سابقة`
                );
              }}
              onCancel={() => router.push("/orders")}
            />

            {/* Row 2: العملة | طريقة الدفع | تاريخ الطلب */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Currency */}
              <div className="space-y-1.5">
                <Label>العملة</Label>
                <SearchableSelect
                  options={currencies.map((c) => ({ value: c.id, label: c.name }))}
                  value={watch("currencyId") ?? ""}
                  onChange={(v) => setValue("currencyId", v, { shouldValidate: true })}
                  placeholder="اختر العملة"
                  error={!!errors.currencyId}
                />
                {errors.currencyId && <p className="text-xs text-destructive">{errors.currencyId.message}</p>}
              </div>

              {/* Payment Method */}
              <div className="space-y-1.5">
                <Label>طريقة الدفع</Label>
                <SearchableSelect
                  options={paymentMethods.map((p) => ({ value: p.id, label: p.name }))}
                  value={watch("paymentMethodId") ?? ""}
                  onChange={(v) => setValue("paymentMethodId", v, { shouldValidate: true })}
                  placeholder="اختر طريقة الدفع"
                  error={!!errors.paymentMethodId}
                />
                {errors.paymentMethodId && <p className="text-xs text-destructive">{errors.paymentMethodId.message}</p>}
              </div>

              {/* Order Date */}
              <div className="space-y-1.5">
                <Label>تاريخ الطلب</Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs hover:bg-accent",
                      errors.orderDate && "border-destructive"
                    )}
                  >
                    <span>{orderDate ? format(orderDate, "dd/MM/yyyy", { locale: arSA }) : "اختر تاريخاً"}</span>
                    <CalendarIcon className="h-4 w-4 opacity-50" />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={orderDate}
                      onDayClick={(day) => { setValue("orderDate", day); setDateOpen(false); }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {errors.orderDate && <p className="text-xs text-destructive">{errors.orderDate.message}</p>}
              </div>
            </div>

            {/* Row 3: العنوان (full-width) */}
            <div className="space-y-1.5">
              <Label>العنوان</Label>
              <Textarea
                {...register("address")}
                placeholder="العنوان التفصيلي (المدينة، الحي، الشارع...)"
                rows={2}
                className={errors.address ? "border-destructive" : ""}
              />
              {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>المنتجات</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ productId: "", quantity: 1, lineTotal: 0 })}
            >
              <Plus className="h-4 w-4 ml-1" />
              إضافة منتج
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {errors.items?.root && (
              <p className="text-xs text-destructive">{errors.items.root.message}</p>
            )}
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-3 items-start">
                {/* Product */}
                <div className="col-span-5 space-y-1">
                  {index === 0 && <Label>المنتج</Label>}
                  <SearchableSelect
                    options={products.map((p) => ({
                      value: p.id,
                      label: p.name,
                      sublabel: p.sku ?? undefined,
                    }))}
                    value={watchedItems[index]?.productId ?? ""}
                    onChange={(v) => {
                      setValue(`items.${index}.productId`, v, { shouldValidate: true });
                    }}
                    placeholder="اختر المنتج"
                    error={!!errors.items?.[index]?.productId}
                  />
                  {errors.items?.[index]?.productId && (
                    <p className="text-xs text-destructive">{errors.items[index]?.productId?.message}</p>
                  )}
                </div>

                {/* Quantity */}
                <div className="col-span-3 space-y-1">
                  {index === 0 && <Label>الكمية</Label>}
                  <Input
                    type="number"
                    min={1}
                    {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                    className={cn(errors.items?.[index]?.quantity && "border-destructive")}
                  />
                </div>

                {/* Line Total */}
                <div className="col-span-3 space-y-1">
                  {index === 0 && <Label>المبلغ</Label>}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    {...register(`items.${index}.lineTotal`, { valueAsNumber: true })}
                    className={cn(errors.items?.[index]?.lineTotal && "border-destructive")}
                  />
                </div>

                {/* Delete */}
                <div className={cn("col-span-1 flex justify-center", index === 0 && "mt-6")}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fields.length > 1 && remove(index)}
                    disabled={fields.length <= 1}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

              </div>
            ))}

            <Separator />
            {/* Row 5: ملاحظات (right) + إجمالي (left) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <Label>ملاحظات (اختياري)</Label>
                <Textarea {...register("notes")} placeholder="أي ملاحظات إضافية..." rows={2} />
              </div>
              <div className="flex justify-end items-end">
                <div className="text-end">
                  <p className="text-sm text-muted-foreground mb-1">الإجمالي الكلي</p>
                  <p className="text-2xl font-bold" dir="ltr">
                    {total.toFixed(2)}{currencySymbol ? <span className="text-lg font-semibold text-muted-foreground mr-1"> {currencySymbol}</span> : null}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3 items-center">
          {submitBlocked && (
            <p className="text-sm text-orange-600 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              يجب الاختيار أولاً: متابعة أو إلغاء الطلب المكرر
            </p>
          )}
          <Button type="button" variant="outline" onClick={() => router.back()}>
            إلغاء
          </Button>
          <Button type="submit" disabled={mutation.isPending || submitBlocked}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
            إنشاء الطلب
          </Button>
        </div>
      </form>
    </div>
  );
}
