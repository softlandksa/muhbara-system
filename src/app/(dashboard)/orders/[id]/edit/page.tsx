"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AppLoadingOverlay } from "@/components/shared/AppLoadingOverlay";

// ─── Schema ──────────────────────────────────────────────────────────────────

const editSchema = z.object({
  customerName: z.string().min(1, "اسم العميل مطلوب"),
  phone: z.string().min(1, "رقم الجوال مطلوب"),
  address: z.string().min(1, "العنوان مطلوب"),
  countryId: z.string().min(1, "الدولة مطلوبة"),
  currencyId: z.string().min(1, "العملة مطلوبة"),
  paymentMethodId: z.string().min(1, "طريقة الدفع مطلوبة"),
  notes: z.string().optional(),
});

type EditFormData = z.infer<typeof editSchema>;

// ─── Types ────────────────────────────────────────────────────────────────────

type LookupItem = { id: string; name: string };
type CountryItem = { id: string; name: string; phoneFormat: string | null; phoneCode: string | null };
type CurrencyItem = { id: string; name: string; symbol: string; code: string };

type OrderDetail = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  notes: string | null;
  country: { id: string; name: string };
  currency: { id: string; name: string; code: string };
  paymentMethod: { id: string; name: string };
  createdBy: { id: string; name: string };
  status: { id: string; name: string; color: string };
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const userId = session?.user?.id;

  const { data: order, isLoading: orderLoading } = useQuery<OrderDetail>({
    queryKey: ["order", id],
    queryFn: () => fetch(`/api/orders/${id}`).then((r) => r.json()).then((r) => r.data),
    enabled: !!id,
  });

  const { data: countries = [] } = useQuery<CountryItem[]>({
    queryKey: ["lookup-countries"],
    queryFn: () => fetch("/api/lookup/countries").then((r) => r.json()).then((r) => r.data),
  });

  const { data: currencies = [] } = useQuery<CurrencyItem[]>({
    queryKey: ["lookup-currencies"],
    queryFn: () => fetch("/api/lookup/currencies").then((r) => r.json()).then((r) => r.data),
  });

  const { data: paymentMethods = [] } = useQuery<LookupItem[]>({
    queryKey: ["lookup-payment-methods"],
    queryFn: () => fetch("/api/lookup/payment-methods").then((r) => r.json()).then((r) => r.data),
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: { customerName: "", phone: "", address: "", countryId: "", currencyId: "", paymentMethodId: "", notes: "" },
  });

  // Pre-populate once order data is loaded
  useEffect(() => {
    if (!order) return;
    reset({
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      countryId: order.country.id,
      currencyId: order.currency.id,
      paymentMethodId: order.paymentMethod.id,
      notes: order.notes ?? "",
    });
  }, [order, reset]);

  const mutation = useMutation({
    mutationFn: async (data: EditFormData) => {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "فشل تحديث الطلب");
      return json.data;
    },
    onSuccess: () => {
      toast.success("تم تحديث الطلب");
      router.push(`/orders/${id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Permission guard — checked after all hooks
  if (role && role !== "ADMIN" && role !== "SALES") {
    router.replace(`/orders/${id}`);
    return null;
  }

  // SALES can only edit their own orders
  if (order && role === "SALES" && userId !== order.createdBy.id) {
    router.replace(`/orders/${id}`);
    return null;
  }

  if (orderLoading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl mx-auto" dir="rtl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
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

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" dir="rtl">
      <AppLoadingOverlay open={mutation.isPending} message="جاري حفظ التعديلات..." />

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" type="button" onClick={() => router.back()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">تعديل الطلب</h1>
          <p className="text-sm text-muted-foreground font-mono">{order.orderNumber}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>بيانات العميل والطلب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>اسم العميل</Label>
                <Input
                  {...register("customerName")}
                  placeholder="الاسم الكامل"
                  className={errors.customerName ? "border-destructive" : ""}
                />
                {errors.customerName && <p className="text-xs text-destructive">{errors.customerName.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>رقم الجوال</Label>
                <Input
                  {...register("phone")}
                  dir="ltr"
                  className={errors.phone ? "border-destructive" : ""}
                />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>

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
            </div>

            <div className="space-y-1.5">
              <Label>العنوان</Label>
              <Textarea
                {...register("address")}
                placeholder="العنوان التفصيلي"
                rows={2}
                className={errors.address ? "border-destructive" : ""}
              />
              {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>ملاحظات (اختياري)</Label>
              <Textarea {...register("notes")} placeholder="أي ملاحظات إضافية..." rows={2} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={mutation.isPending}>
            إلغاء
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
            حفظ التعديلات
          </Button>
        </div>
      </form>
    </div>
  );
}
