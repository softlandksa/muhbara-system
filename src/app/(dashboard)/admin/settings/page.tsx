"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, ToggleLeft, ToggleRight, Loader2, Trash2, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

type Country = {
  id: string;
  name: string;
  code: string;
  phoneCode: string | null;
  phoneFormat: string | null;
  isActive: boolean;
};

type Currency = {
  id: string;
  name: string;
  code: string;
  symbol: string;
  isActive: boolean;
};

type PaymentMethod = {
  id: string;
  name: string;
  isActive: boolean;
};

type ShippingCompany = {
  id: string;
  name: string;
  trackingUrl: string | null;
  isActive: boolean;
};

type ShippingStatusSub = {
  id: string;
  primaryId: string;
  name: string;
  colorOverride: string | null;
  sortOrder: number;
  isActive: boolean;
  marksOrderDelivered: boolean;
};

type ShippingStatusPrimary = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  subs: ShippingStatusSub[];
};

type ReplacementOption = { id: string; name: string; colorOverride: string | null };
type PrimaryDeleteReplacement = { id: string; name: string; primaryName: string };

type Product = {
  id: string;
  name: string;
  sku: string | null;
  defaultPrice: number;
  isActive: boolean;
};

// ─── Generic Hook ─────────────────────────────────────────────────────────────

function useSettingsData<T>(endpoint: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      const json = await res.json();
      setItems(json.data ?? []);
    } catch {
      toast.error("فشل تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  return { items, loading, reload: load };
}

// ─── Countries Tab ────────────────────────────────────────────────────────────

function CountriesTab() {
  const { items, loading, reload } = useSettingsData<Country>("/api/settings/countries");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Country | null>(null);
  const [form, setForm] = useState({ name: "", code: "", phoneCode: "", phoneFormat: "" });

  function openAdd() {
    setEditing(null);
    setForm({ name: "", code: "", phoneCode: "", phoneFormat: "" });
    setOpen(true);
  }

  function openEdit(item: Country) {
    setEditing(item);
    setForm({
      name: item.name,
      code: item.code,
      phoneCode: item.phoneCode ?? "",
      phoneFormat: item.phoneFormat ?? "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.code) return toast.error("الاسم والكود مطلوبان");
    setSaving(true);
    try {
      const url = editing ? `/api/settings/countries/${editing.id}` : "/api/settings/countries";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: Country) {
    await fetch(`/api/settings/countries/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    reload();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">الدول</h3>
        <Button type="button" onClick={openAdd} size="sm"><Plus className="w-4 h-4 ml-1" />إضافة دولة</Button>
      </div>
      {loading ? <LoadingRows /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الكود</TableHead>
              <TableHead>كود الهاتف</TableHead>
              <TableHead>صيغة الرقم</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-24">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>{item.code}</TableCell>
                <TableCell>{item.phoneCode ?? "—"}</TableCell>
                <TableCell dir="ltr" className="text-right">{item.phoneFormat ?? "—"}</TableCell>
                <TableCell><StatusBadge active={item.isActive} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل دولة" : "إضافة دولة"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="مصر" />
            <Field label="الكود *" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} placeholder="EG" />
            <Field label="كود الهاتف" value={form.phoneCode} onChange={(v) => setForm({ ...form, phoneCode: v })} placeholder="+20" />
            <Field label="صيغة الرقم" value={form.phoneFormat} onChange={(v) => setForm({ ...form, phoneFormat: v })} placeholder="01XXXXXXXXX" dir="ltr" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Currencies Tab ───────────────────────────────────────────────────────────

function CurrenciesTab() {
  const { items, loading, reload } = useSettingsData<Currency>("/api/settings/currencies");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Currency | null>(null);
  const [form, setForm] = useState({ name: "", code: "", symbol: "" });

  function openAdd() { setEditing(null); setForm({ name: "", code: "", symbol: "" }); setOpen(true); }
  function openEdit(item: Currency) { setEditing(item); setForm({ name: item.name, code: item.code, symbol: item.symbol }); setOpen(true); }

  async function handleSave() {
    if (!form.name || !form.code || !form.symbol) return toast.error("جميع الحقول مطلوبة");
    setSaving(true);
    try {
      const url = editing ? `/api/settings/currencies/${editing.id}` : "/api/settings/currencies";
      const res = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); reload();
    } finally { setSaving(false); }
  }

  async function toggleActive(item: Currency) {
    await fetch(`/api/settings/currencies/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
    reload();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">العملات</h3>
        <Button type="button" onClick={openAdd} size="sm"><Plus className="w-4 h-4 ml-1" />إضافة عملة</Button>
      </div>
      {loading ? <LoadingRows /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الكود</TableHead>
              <TableHead>الرمز</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-24">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>{item.code}</TableCell>
                <TableCell>{item.symbol}</TableCell>
                <TableCell><StatusBadge active={item.isActive} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل عملة" : "إضافة عملة"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="جنيه مصري" />
            <Field label="الكود *" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} placeholder="EGP" />
            <Field label="الرمز *" value={form.symbol} onChange={(v) => setForm({ ...form, symbol: v })} placeholder="ج.م" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Payment Methods Tab ──────────────────────────────────────────────────────

function PaymentMethodsTab() {
  const { items, loading, reload } = useSettingsData<PaymentMethod>("/api/settings/payment-methods");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [name, setName] = useState("");

  function openAdd() { setEditing(null); setName(""); setOpen(true); }
  function openEdit(item: PaymentMethod) { setEditing(item); setName(item.name); setOpen(true); }

  async function handleSave() {
    if (!name) return toast.error("الاسم مطلوب");
    setSaving(true);
    try {
      const url = editing ? `/api/settings/payment-methods/${editing.id}` : "/api/settings/payment-methods";
      const res = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); reload();
    } finally { setSaving(false); }
  }

  async function toggleActive(item: PaymentMethod) {
    await fetch(`/api/settings/payment-methods/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
    reload();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">طرق الدفع</h3>
        <Button type="button" onClick={openAdd} size="sm"><Plus className="w-4 h-4 ml-1" />إضافة طريقة</Button>
      </div>
      {loading ? <LoadingRows /> : (
        <Table>
          <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>الحالة</TableHead><TableHead className="w-24">إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell><StatusBadge active={item.isActive} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل طريقة دفع" : "إضافة طريقة دفع"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={name} onChange={setName} placeholder="كاش عند الاستلام" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Shipping Companies Tab ───────────────────────────────────────────────────

function ShippingCompaniesTab() {
  const { items, loading, reload } = useSettingsData<ShippingCompany>("/api/settings/shipping-companies");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ShippingCompany | null>(null);
  const [form, setForm] = useState({ name: "", trackingUrl: "" });

  function openAdd() { setEditing(null); setForm({ name: "", trackingUrl: "" }); setOpen(true); }
  function openEdit(item: ShippingCompany) { setEditing(item); setForm({ name: item.name, trackingUrl: item.trackingUrl ?? "" }); setOpen(true); }

  async function handleSave() {
    if (!form.name) return toast.error("الاسم مطلوب");
    setSaving(true);
    try {
      const url = editing ? `/api/settings/shipping-companies/${editing.id}` : "/api/settings/shipping-companies";
      const res = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, trackingUrl: form.trackingUrl || null }) });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); reload();
    } finally { setSaving(false); }
  }

  async function toggleActive(item: ShippingCompany) {
    await fetch(`/api/settings/shipping-companies/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
    reload();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">شركات الشحن</h3>
        <Button type="button" onClick={openAdd} size="sm"><Plus className="w-4 h-4 ml-1" />إضافة شركة</Button>
      </div>
      {loading ? <LoadingRows /> : (
        <Table>
          <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>رابط التتبع</TableHead><TableHead>الحالة</TableHead><TableHead className="w-24">إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-sm text-gray-500 max-w-xs truncate" dir="ltr">{item.trackingUrl ?? "—"}</TableCell>
                <TableCell><StatusBadge active={item.isActive} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل شركة شحن" : "إضافة شركة شحن"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="أرامكس" />
            <Field label="رابط التتبع" value={form.trackingUrl} onChange={(v) => setForm({ ...form, trackingUrl: v })} placeholder="https://example.com/track/{tracking}" dir="ltr" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Shipping Statuses — Primaries Tab ───────────────────────────────────────

function ShippingStatusPrimariesTab({ onReload }: { onReload: () => void }) {
  const { items, loading, reload } = useSettingsData<ShippingStatusPrimary>("/api/settings/shipping-statuses");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ShippingStatusPrimary | null>(null);
  const [form, setForm] = useState({ name: "", color: "#6b7280", sortOrder: "0" });
  const [deleteTarget, setDeleteTarget] = useState<ShippingStatusPrimary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [primaryReplaceTarget, setPrimaryReplaceTarget] = useState<ShippingStatusPrimary | null>(null);
  const [primaryReplacements, setPrimaryReplacements] = useState<PrimaryDeleteReplacement[]>([]);
  const [primaryInUseCount, setPrimaryInUseCount] = useState(0);
  const [primaryReplacementId, setPrimaryReplacementId] = useState("");
  const [primaryReplacing, setPrimaryReplacing] = useState(false);

  function reloadAll() {
    reload();
    onReload();
    queryClient.invalidateQueries({ queryKey: ["shipping-statuses"] });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openAdd() { setEditing(null); setForm({ name: "", color: "#6b7280", sortOrder: String(items.length + 1) }); setOpen(true); }
  function openEdit(item: ShippingStatusPrimary) { setEditing(item); setForm({ name: item.name, color: item.color, sortOrder: String(item.sortOrder) }); setOpen(true); }

  async function handleSave() {
    if (!form.name) return toast.error("الاسم مطلوب");
    setSaving(true);
    try {
      const url = editing ? `/api/settings/shipping-statuses/${editing.id}` : "/api/settings/shipping-statuses";
      const res = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, color: form.color, sortOrder: parseInt(form.sortOrder) || 0 }) });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); reloadAll();
    } finally { setSaving(false); }
  }

  async function toggleActive(item: ShippingStatusPrimary) {
    const res = await fetch(`/api/settings/shipping-statuses/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "حدث خطأ"); return; }
    reloadAll();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/settings/shipping-statuses/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        // ShippingInfo records reference subs under this primary — show migration dialog
        if (res.status === 409 && json.inUse) {
          setDeleteTarget(null);
          setPrimaryReplaceTarget(deleteTarget);
          setPrimaryReplacements(json.replacements ?? []);
          setPrimaryInUseCount(json.inUse);
          setPrimaryReplacementId("");
          return;
        }
        toast.error(json.error ?? "فشل الحذف");
        return;
      }
      toast.success("تم حذف الحالة");
      setDeleteTarget(null);
      reloadAll();
    } finally { setDeleting(false); }
  }

  async function handlePrimaryReplace() {
    if (!primaryReplaceTarget || !primaryReplacementId) return toast.error("اختر حالة بديلة");
    setPrimaryReplacing(true);
    try {
      const res = await fetch(`/api/settings/shipping-statuses/${primaryReplaceTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacementSubId: primaryReplacementId }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "فشل الحذف"); return; }
      toast.success(`تم نقل ${primaryInUseCount} شحنة وحذف الحالة`);
      setPrimaryReplaceTarget(null);
      reloadAll();
    } finally { setPrimaryReplacing(false); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold">حالات الشحن الرئيسية</h3>
          <p className="text-xs text-muted-foreground mt-0.5">اضغط السهم لعرض الحالات الفرعية وإدارتها</p>
        </div>
        <Button type="button" onClick={openAdd} size="sm"><Plus className="w-4 h-4 ml-1" />إضافة حالة رئيسية</Button>
      </div>
      {loading ? <LoadingRows /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>اللون</TableHead>
              <TableHead>الحالات الفرعية</TableHead>
              <TableHead>الترتيب</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="w-28">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <React.Fragment key={item.id}>
                <TableRow className="cursor-pointer" onClick={() => toggleExpand(item.id)}>
                  <TableCell className="w-8 text-center text-muted-foreground">
                    {expanded.has(item.id) ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}
                  </TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full border" style={{ backgroundColor: item.color }} />
                      <span className="text-xs text-gray-500" dir="ltr">{item.color}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{item.subs.length} فرعية</span>
                  </TableCell>
                  <TableCell>{item.sortOrder}</TableCell>
                  <TableCell><StatusBadge active={item.isActive} /></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                        {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteTarget(item)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded.has(item.id) && (
                  <TableRow key={`${item.id}-subs`}>
                    <TableCell />
                    <TableCell colSpan={6} className="py-0 pb-2">
                      <SubsPanel primary={item} onReload={reloadAll} />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add / Edit primary dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل حالة رئيسية" : "إضافة حالة رئيسية"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="في الطريق" />
            <div className="grid gap-1">
              <Label>اللون</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer border" />
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-32" dir="ltr" />
              </div>
            </div>
            <Field label="الترتيب" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="1" type="number" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete primary confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>حذف الحالة الرئيسية</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            هل أنت متأكد من حذف <span className="font-semibold text-foreground">{deleteTarget?.name}</span> وجميع حالاتها الفرعية؟
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>إلغاء</Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replacement dialog — shown when ShippingInfo records reference subs under the primary being deleted */}
      <Dialog open={!!primaryReplaceTarget} onOpenChange={(o) => !o && setPrimaryReplaceTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>الحالة قيد الاستخدام — اختر حالة بديلة للشحنات</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            هناك <span className="font-semibold text-foreground">{primaryInUseCount}</span> شحنة مرتبطة بحالات فرعية تحت{" "}
            <span className="font-semibold text-foreground">{primaryReplaceTarget?.name}</span>.
            اختر حالة فرعية من مجموعة أخرى لنقل هذه الشحنات إليها قبل الحذف.
          </p>
          {primaryReplacements.length === 0 ? (
            <p className="text-sm text-destructive">لا توجد حالات فرعية نشطة في مجموعات أخرى. أضف حالة بديلة أولاً.</p>
          ) : (
            <div className="grid gap-2 mt-2">
              <Label>الحالة البديلة</Label>
              <Select value={primaryReplacementId} onValueChange={(v) => setPrimaryReplacementId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر حالة فرعية بديلة..." />
                </SelectTrigger>
                <SelectContent>
                  {primaryReplacements.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} — {r.primaryName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPrimaryReplaceTarget(null)} disabled={primaryReplacing}>إلغاء</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handlePrimaryReplace}
              disabled={primaryReplacing || !primaryReplacementId || primaryReplacements.length === 0}
            >
              {primaryReplacing && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}نقل وحذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── SubsPanel ────────────────────────────────────────────────────────────────

function SubsPanel({ primary, onReload }: { primary: ShippingStatusPrimary; onReload: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSub, setEditingSub] = useState<ShippingStatusSub | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShippingStatusSub | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subForm, setSubForm] = useState({ name: "", colorOverride: "", sortOrder: "1", marksOrderDelivered: false });

  // Replacement dialog state
  const [replaceTarget, setReplaceTarget] = useState<ShippingStatusSub | null>(null);
  const [replacements, setReplacements] = useState<ReplacementOption[]>([]);
  const [inUseCount, setInUseCount] = useState(0);
  const [replacementId, setReplacementId] = useState("");
  const [replacing, setReplacing] = useState(false);

  function openAddSub() {
    setEditingSub(null);
    setSubForm({ name: "", colorOverride: "", sortOrder: String(primary.subs.length + 1), marksOrderDelivered: false });
    setOpen(true);
  }
  function openEditSub(s: ShippingStatusSub) {
    setEditingSub(s);
    setSubForm({ name: s.name, colorOverride: s.colorOverride ?? "", sortOrder: String(s.sortOrder), marksOrderDelivered: s.marksOrderDelivered });
    setOpen(true);
  }

  async function handleSaveSub() {
    if (!subForm.name) return toast.error("الاسم مطلوب");
    setSaving(true);
    try {
      const url = editingSub
        ? `/api/settings/shipping-status-subs/${editingSub.id}`
        : `/api/settings/shipping-statuses/${primary.id}/subs`;
      const res = await fetch(url, {
        method: editingSub ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: subForm.name,
          colorOverride: subForm.colorOverride || null,
          sortOrder: parseInt(subForm.sortOrder) || 0,
          marksOrderDelivered: subForm.marksOrderDelivered,
        }),
      });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editingSub ? "تم التحديث" : "تمت الإضافة");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["shipping-statuses"] });
      onReload();
    } finally { setSaving(false); }
  }

  async function toggleSubActive(s: ShippingStatusSub) {
    const res = await fetch(`/api/settings/shipping-status-subs/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
    });
    const json = await res.json();
    if (!res.ok) {
      // 409 with in-use details → show replacement dialog
      if (res.status === 409 && json.inUse) {
        setReplaceTarget(s);
        setReplacements(json.replacements ?? []);
        setInUseCount(json.inUse);
        setReplacementId("");
        return;
      }
      toast.error(json.error ?? "حدث خطأ");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["shipping-statuses"] });
    onReload();
  }

  async function handleReplace() {
    if (!replaceTarget || !replacementId) return toast.error("اختر حالة بديلة");
    setReplacing(true);
    try {
      const res = await fetch(`/api/settings/shipping-status-subs/${replaceTarget.id}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacementSubId: replacementId }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "فشل النقل"); return; }
      toast.success(`تم نقل ${json.data?.affected ?? 0} شحنة وتعطيل الحالة`);
      setReplaceTarget(null);
      queryClient.invalidateQueries({ queryKey: ["shipping-statuses"] });
      onReload();
    } finally { setReplacing(false); }
  }

  async function handleDeleteSub() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/settings/shipping-status-subs/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "فشل الحذف"); return; }
      toast.success("تم حذف الحالة الفرعية");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["shipping-statuses"] });
      onReload();
    } finally { setDeleting(false); }
  }

  const effectiveColor = (s: ShippingStatusSub) => s.colorOverride ?? primary.color;

  return (
    <div className="border rounded-lg mt-1 mb-2 overflow-hidden">
      <div className="flex justify-between items-center px-3 py-2 bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">الحالات الفرعية</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={openAddSub}>
          <Plus className="w-3 h-3 ml-1" />إضافة
        </Button>
      </div>
      {primary.subs.length === 0 ? (
        <p className="text-xs text-muted-foreground px-3 py-2">لا توجد حالات فرعية</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {primary.subs.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-1.5 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block border" style={{ backgroundColor: effectiveColor(s) }} />
                  <span className={s.isActive ? "" : "line-through text-muted-foreground"}>{s.name}</span>
                  {s.marksOrderDelivered && (
                    <span title="يسجّل كـ'مُوصَّل'">
                      <CheckCircle2 className="w-3 h-3 text-green-600" />
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground w-10 text-center">{s.sortOrder}</td>
                <td className="px-3 py-1.5 w-24">
                  <div className="flex gap-0.5 justify-end">
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditSub(s)}><Pencil className="w-3 h-3" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleSubActive(s)}>
                      {s.isActive ? <ToggleRight className="w-3 h-3 text-green-600" /> : <ToggleLeft className="w-3 h-3 text-gray-400" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDeleteTarget(s)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add / Edit sub dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSub ? "تعديل حالة فرعية" : "إضافة حالة فرعية"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={subForm.name} onChange={(v) => setSubForm({ ...subForm, name: v })} placeholder="في الطريق — منطقة شمال" />
            <div className="grid gap-1">
              <Label>لون مخصص (اختياري — يستخدم لون الحالة الرئيسية إذا تُرك فارغاً)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={subForm.colorOverride || primary.color}
                  onChange={(e) => setSubForm({ ...subForm, colorOverride: e.target.value })}
                  className="w-10 h-10 rounded cursor-pointer border"
                />
                <Input
                  value={subForm.colorOverride}
                  onChange={(e) => setSubForm({ ...subForm, colorOverride: e.target.value })}
                  placeholder="(يستخدم لون الرئيسية)"
                  className="w-36"
                  dir="ltr"
                />
                {subForm.colorOverride && (
                  <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSubForm({ ...subForm, colorOverride: "" })}>مسح</Button>
                )}
              </div>
            </div>
            <Field label="الترتيب" value={subForm.sortOrder} onChange={(v) => setSubForm({ ...subForm, sortOrder: v })} placeholder="1" type="number" />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="marksDelivered"
                checked={subForm.marksOrderDelivered}
                onChange={(e) => setSubForm({ ...subForm, marksOrderDelivered: e.target.checked })}
                className="w-4 h-4"
              />
              <Label htmlFor="marksDelivered" className="cursor-pointer">يُسجَّل هذا كـ&quot;تم التوصيل&quot; (يضبط تاريخ التسليم)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSaveSub} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replacement dialog — shown when deactivating an in-use sub */}
      <Dialog open={!!replaceTarget} onOpenChange={(o) => !o && setReplaceTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>الحالة قيد الاستخدام — اختر بديلاً</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            الحالة <span className="font-semibold text-foreground">{replaceTarget?.name}</span> مستخدمة في{" "}
            <span className="font-semibold text-foreground">{inUseCount}</span> شحنة.
            اختر حالة بديلة لنقل هذه الشحنات إليها قبل التعطيل.
          </p>
          {replacements.length === 0 ? (
            <p className="text-sm text-destructive">لا توجد حالات فرعية أخرى نشطة في هذه المجموعة. أضف حالة بديلة أولاً.</p>
          ) : (
            <div className="grid gap-2 mt-2">
              <Label>الحالة البديلة</Label>
              <Select value={replacementId} onValueChange={(v) => setReplacementId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر حالة بديلة..." />
                </SelectTrigger>
                <SelectContent>
                  {replacements.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReplaceTarget(null)} disabled={replacing}>إلغاء</Button>
            <Button type="button" onClick={handleReplace} disabled={replacing || !replacementId || replacements.length === 0}>
              {replacing && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}نقل وتعطيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete sub confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>حذف الحالة الفرعية</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            هل أنت متأكد من حذف <span className="font-semibold text-foreground">{deleteTarget?.name}</span>؟
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>إلغاء</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteSub} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab() {
  const { items, loading, reload } = useSettingsData<Product>("/api/settings/products");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", defaultPrice: "" });

  function openAdd() { setEditing(null); setForm({ name: "", sku: "", defaultPrice: "" }); setOpen(true); }
  function openEdit(item: Product) { setEditing(item); setForm({ name: item.name, sku: item.sku ?? "", defaultPrice: String(item.defaultPrice) }); setOpen(true); }

  async function handleSave() {
    if (!form.name) return toast.error("الاسم مطلوب");
    setSaving(true);
    try {
      const url = editing ? `/api/settings/products/${editing.id}` : "/api/settings/products";
      const res = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, sku: form.sku || null, defaultPrice: parseFloat(form.defaultPrice) || 0 }) });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); reload();
    } finally { setSaving(false); }
  }

  async function toggleActive(item: Product) {
    await fetch(`/api/settings/products/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
    reload();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">المنتجات</h3>
        <Button type="button" onClick={openAdd} size="sm"><Plus className="w-4 h-4 ml-1" />إضافة منتج</Button>
      </div>
      {loading ? <LoadingRows /> : (
        <Table>
          <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>SKU</TableHead><TableHead>السعر الافتراضي</TableHead><TableHead>الحالة</TableHead><TableHead className="w-24">إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell dir="ltr" className="text-right">{item.sku ?? "—"}</TableCell>
                <TableCell>{item.defaultPrice.toLocaleString("ar-EG")}</TableCell>
                <TableCell><StatusBadge active={item.isActive} /></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => toggleActive(item)}>
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل منتج" : "إضافة منتج"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="اسم المنتج" />
            <Field label="SKU" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} placeholder="PROD-001" dir="ltr" />
            <Field label="السعر الافتراضي" value={form.defaultPrice} onChange={(v) => setForm({ ...form, defaultPrice: v })} placeholder="0" type="number" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "default" : "secondary"} className={active ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-gray-100 text-gray-600"}>
      {active ? "نشط" : "معطّل"}
    </Badge>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
      ))}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", dir }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; dir?: string;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} dir={dir} />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // Shared reload trigger so primaries tab and the standalone trigger stay in sync
  const [statusReloadKey, setStatusReloadKey] = useState(0);
  const triggerStatusReload = useCallback(() => setStatusReloadKey((k) => k + 1), []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">الإعدادات</h1>
        <p className="text-gray-500 text-sm mt-1">إدارة بيانات القوائم المنسدلة في النظام</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <Tabs defaultValue="countries">
          <TabsList className="mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="countries">الدول</TabsTrigger>
            <TabsTrigger value="currencies">العملات</TabsTrigger>
            <TabsTrigger value="payment-methods">طرق الدفع</TabsTrigger>
            <TabsTrigger value="shipping-companies">شركات الشحن</TabsTrigger>
            <TabsTrigger value="shipping-statuses">حالات الشحن</TabsTrigger>
            <TabsTrigger value="products">المنتجات</TabsTrigger>
          </TabsList>
          <TabsContent value="countries"><CountriesTab /></TabsContent>
          <TabsContent value="currencies"><CurrenciesTab /></TabsContent>
          <TabsContent value="payment-methods"><PaymentMethodsTab /></TabsContent>
          <TabsContent value="shipping-companies"><ShippingCompaniesTab /></TabsContent>
          <TabsContent value="shipping-statuses">
            <ShippingStatusPrimariesTab key={statusReloadKey} onReload={triggerStatusReload} />
          </TabsContent>
          <TabsContent value="products"><ProductsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
