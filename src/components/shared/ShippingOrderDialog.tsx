"use client";

import { useState, useEffect } from "react";
import { Loader2, Truck, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AppLoadingOverlay } from "@/components/shared/AppLoadingOverlay";

type ShippingCompany = { id: string; name: string };
type ShippingStatusSub = { id: string; name: string };
type ShippingStatusItem = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  subs: ShippingStatusSub[];
};

export type ExistingShippingInfo = {
  id: string;
  shippingCompanyId: string;
  shippingSubStatusId: string | null;
  trackingNumber: string | null;
};

interface ShippingOrderDialogProps {
  orderId: string;
  orderNumber: string;
  companies: ShippingCompany[];
  statuses: ShippingStatusItem[];
  /** null → create new (POST); non-null → edit existing (PUT) */
  existingShipping: ExistingShippingInfo | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function ShippingOrderDialog({
  orderId,
  orderNumber,
  companies,
  statuses,
  existingShipping,
  open,
  onClose,
  onDone,
}: ShippingOrderDialogProps) {
  const isEdit = existingShipping !== null;

  const [companyId, setCompanyId] = useState("");
  const [subStatusId, setSubStatusId] = useState("");
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (isEdit && existingShipping) {
      setCompanyId(existingShipping.shippingCompanyId ?? "");
      setSubStatusId(existingShipping.shippingSubStatusId ?? "");
      setTracking(existingShipping.trackingNumber ?? "");
      setNotes("");
    } else {
      setCompanyId("");
      setSubStatusId("");
      setTracking("");
      setNotes("");
    }
    setErrors({});
  }, [open, isEdit, existingShipping]);

  const reset = () => {
    setCompanyId("");
    setSubStatusId("");
    setTracking("");
    setNotes("");
    setErrors({});
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const validate = () => {
    const e: Record<string, string> = {};
    // shippingCompanyId is NOT NULL in DB — required for new records only.
    // For edits, the existing company stays if not changed.
    if (!isEdit && !companyId) e.company = "شركة الشحن مطلوبة عند أول شحنة";
    if (!subStatusId) e.status = "حالة الشحن مطلوبة";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      let res: Response;
      if (isEdit && existingShipping) {
        res = await fetch(`/api/shipping/${existingShipping.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subStatusId,
            // Only send company if user explicitly changed it
            ...(companyId && { shippingCompanyId: companyId }),
            trackingNumber: tracking.trim() || undefined,
          }),
        });
      } else {
        res = await fetch("/api/shipping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            shippingCompanyId: companyId, // required — validated above
            subStatusId,
            trackingNumber: tracking.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        });
      }

      let json: { error?: string; data?: { isDelivered?: boolean } } = {};
      try {
        json = await res.json();
      } catch {
        /* non-JSON response */
      }

      if (!res.ok) {
        toast.error(json.error ?? (isEdit ? "فشل تحديث الشحن" : "فشل الشحن"));
        return;
      }

      if (isEdit) {
        toast.success(
          json.data?.isDelivered
            ? "تم تسجيل التسليم بنجاح"
            : "تم تحديث بيانات الشحن"
        );
      } else {
        toast.success(`تم شحن الطلب ${orderNumber}`);
      }

      reset();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  // Confirm is disabled until required fields are filled
  const canConfirm = subStatusId && (isEdit || !!companyId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent dir="rtl" className="max-w-md relative">
        <AppLoadingOverlay
          open={loading}
          mode="inline"
          message={isEdit ? "جاري تحديث الشحن..." : "جاري تسجيل الشحن..."}
        />
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `تعديل بيانات الشحن — ${orderNumber}`
              : `شحن الطلب ${orderNumber}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Company — required for create, optional for edit */}
          <div className="space-y-1.5">
            <Label>
              شركة الشحن{" "}
              {isEdit ? (
                <span className="text-muted-foreground text-xs">(اختياري — يُبقي الشركة الحالية إن تُرك فارغاً)</span>
              ) : (
                <span className="text-destructive">*</span>
              )}
            </Label>
            <SearchableSelect
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              value={companyId}
              onChange={setCompanyId}
              placeholder="اختر شركة الشحن"
              error={!!errors.company}
            />
            {errors.company && (
              <p className="text-xs text-destructive">{errors.company}</p>
            )}
          </div>

          {/* Sub-status — always required */}
          <div className="space-y-1.5">
            <Label>
              حالة الشحن <span className="text-destructive">*</span>
            </Label>
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
            {errors.status && (
              <p className="text-xs text-destructive">{errors.status}</p>
            )}
          </div>

          {/* Tracking */}
          <div className="space-y-1.5">
            <Label>رقم التتبع (اختياري)</Label>
            <Input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="رقم التتبع"
              dir="ltr"
            />
          </div>

          {/* Notes — create only */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>ملاحظات (اختياري)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات الشحن..."
                rows={2}
              />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canConfirm || loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin ml-1" />
            ) : isEdit ? (
              <Pencil className="h-4 w-4 ml-1" />
            ) : (
              <Truck className="h-4 w-4 ml-1" />
            )}
            {isEdit ? "حفظ التعديلات" : "تأكيد الشحن"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
