"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

export type ShippingCompanyOption = { id: string; name: string };
export type ShippingStatusSubOption = {
  id: string;
  name: string;
  colorOverride: string | null;
  marksOrderDelivered: boolean;
};
export type ShippingStatusOption = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  subs: ShippingStatusSubOption[];
};

interface ShippingStatusDialogProps {
  orderIds: string[];
  statuses: ShippingStatusOption[];
  companies: ShippingCompanyOption[];
  open: boolean;
  loading: boolean;
  /** When true, company is required (first-time shipping — no existing record) */
  requiresCompany?: boolean;
  onClose: () => void;
  onSubmit: (subStatusId: string, shippingCompanyId?: string, trackingNumber?: string) => void;
}

export function ShippingStatusDialog({
  orderIds,
  statuses,
  companies,
  open,
  loading,
  requiresCompany = false,
  onClose,
  onSubmit,
}: ShippingStatusDialogProps) {
  const [subStatusId, setSubStatusId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [tracking, setTracking] = useState("");
  const [companyError, setCompanyError] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) { setSubStatusId(""); setCompanyId(""); setTracking(""); setCompanyError(false); }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClose = () => {
    if (loading) return;
    setSubStatusId(""); setCompanyId(""); setTracking(""); setCompanyError(false);
    onClose();
  };

  const handleConfirm = () => {
    if (!subStatusId || orderIds.length === 0 || loading) return;
    if (requiresCompany && !companyId) { setCompanyError(true); return; }
    setCompanyError(false);
    onSubmit(subStatusId, companyId || undefined, tracking.trim() || undefined);
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
                  listLabel: s.name,
                  group: p.name,
                  color: s.colorOverride ?? p.color,
                }))
              )}
              value={subStatusId}
              onChange={setSubStatusId}
              placeholder="اختر حالة الشحن"
              boldGroups
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              شركة الشحن{" "}
              {requiresCompany ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  (اختياري — يُغيّر شركة الشحن {orderIds.length > 1 ? "لجميع الطلبات المحددة" : "للطلب"})
                </span>
              )}
            </Label>
            <SearchableSelect
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              value={companyId}
              onChange={(v) => { setCompanyId(v); if (v) setCompanyError(false); }}
              placeholder={requiresCompany ? "اختر شركة الشحن" : "اتركه فارغاً للإبقاء على الشركة الحالية"}
              error={companyError}
            />
            {companyError && (
              <p className="text-xs text-destructive">شركة الشحن مطلوبة عند أول شحنة</p>
            )}
          </div>
        </div>
        <DialogFooter className="sm:items-end sm:justify-between gap-3">
          <div className="space-y-1 sm:flex-1">
            <Label className="text-xs text-muted-foreground">رقم تتبع الشحنة</Label>
            <Input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="اختياري"
              dir="ltr"
              disabled={loading}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              className="transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
              onClick={handleClose}
              disabled={loading}
            >
              إلغاء
            </Button>
            <Button
              type="button"
              className="transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
              onClick={handleConfirm}
              disabled={!subStatusId || (requiresCompany && !companyId) || loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
              تأكيد
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
