"use client";

import { useState, useEffect, useCallback } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, ToggleLeft, ToggleRight, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";

type Team = { id: string; name: string };

type Employee = {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
  team: Team | null;
  isActive: boolean;
  createdAt: string;
};

const ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR"];

export default function EmployeesPage() {
  const { data: session } = useSession();
  const isReadOnly = session?.user?.role === "GENERAL_MANAGER";
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "SALES" as Role,
    teamId: "",
  });

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const json = await res.json();
      setEmployees(json.data ?? []);
    } catch {
      toast.error("فشل تحميل الموظفين");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTeams = useCallback(async () => {
    const res = await fetch("/api/teams");
    const json = await res.json();
    setTeams(json.data ?? []);
  }, []);

  useEffect(() => {
    loadEmployees();
    loadTeams();
  }, [loadEmployees, loadTeams]);

  function openAdd() {
    setEditing(null);
    setForm({ name: "", email: "", password: "", role: "SALES", teamId: "" });
    setOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditing(emp);
    setForm({
      name: emp.name,
      email: emp.email,
      password: "",
      role: emp.role,
      teamId: emp.teamId ?? "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.email) return toast.error("الاسم والإيميل مطلوبان");
    if (!editing && !form.password) return toast.error("كلمة المرور مطلوبة للموظف الجديد");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        role: form.role,
        teamId: form.teamId || null,
      };
      if (form.password) body.password = form.password;

      const url = editing ? `/api/users/${editing.id}` : "/api/users";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success(editing ? "تم تحديث بيانات الموظف" : "تمت إضافة الموظف");
      setOpen(false);
      loadEmployees();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(emp: Employee) {
    const res = await fetch(`/api/users/${emp.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !emp.isActive }),
    });
    const json = await res.json();
    if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
    toast.success(emp.isActive ? "تم تعطيل الموظف" : "تم تفعيل الموظف");
    loadEmployees();
  }

  const filtered = employees.filter(
    (e) =>
      e.name.includes(search) ||
      e.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الموظفون</h1>
          <p className="text-gray-500 text-sm mt-1">إدارة حسابات الموظفين وصلاحياتهم</p>
        </div>
        {!isReadOnly && (
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 ml-1" />
            إضافة موظف
          </Button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b">
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الإيميل..."
              className="pr-9"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            جاري التحميل...
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>البريد الإلكتروني</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead>الفريق</TableHead>
                <TableHead>الحالة</TableHead>
                {!isReadOnly && <TableHead className="w-28">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isReadOnly ? 5 : 6} className="text-center text-gray-500 py-8">
                    لا يوجد موظفون
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((emp) => (
                  <TableRow key={emp.id} className="hover:bg-gray-50">
                    <TableCell className="font-medium">{emp.name}</TableCell>
                    <TableCell dir="ltr" className="text-right text-gray-600">{emp.email}</TableCell>
                    <TableCell>
                      <RoleBadge role={emp.role} />
                    </TableCell>
                    <TableCell className="text-gray-600">{emp.team?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={emp.isActive
                          ? "bg-green-100 text-green-800 hover:bg-green-100"
                          : "bg-gray-100 text-gray-600"}
                      >
                        {emp.isActive ? "نشط" : "معطّل"}
                      </Badge>
                    </TableCell>
                    {!isReadOnly && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(emp)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => toggleActive(emp)}>
                            {emp.isActive
                              ? <ToggleRight className="w-4 h-4 text-green-600" />
                              : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        <div className="p-3 border-t text-sm text-gray-500 text-right">
          إجمالي: {filtered.length} موظف
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل بيانات موظف" : "إضافة موظف جديد"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1">
              <Label>الاسم الكامل *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="محمد أحمد" />
            </div>
            <div className="grid gap-1">
              <Label>البريد الإلكتروني *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" dir="ltr" />
            </div>
            <div className="grid gap-1">
              <Label>{editing ? "كلمة المرور الجديدة (اتركها فارغة للإبقاء على الحالية)" : "كلمة المرور *"}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" dir="ltr" />
            </div>
            <div className="grid gap-1">
              <Label>الدور *</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>الفريق</Label>
              <Select value={form.teamId || "none"} onValueChange={(v) => setForm({ ...form, teamId: v === "none" ? "" : (v ?? "") })}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون فريق" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون فريق</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const colors: Record<Role, string> = {
    ADMIN: "bg-purple-100 text-purple-800",
    GENERAL_MANAGER: "bg-violet-100 text-violet-800",
    SALES_MANAGER: "bg-blue-100 text-blue-800",
    SALES: "bg-cyan-100 text-cyan-800",
    SUPPORT: "bg-teal-100 text-teal-800",
    SHIPPING: "bg-amber-100 text-amber-800",
    FOLLOWUP: "bg-pink-100 text-pink-800",
    HR: "bg-rose-100 text-rose-800",
  };
  return (
    <Badge variant="secondary" className={`${colors[role]} hover:${colors[role]}`}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}
