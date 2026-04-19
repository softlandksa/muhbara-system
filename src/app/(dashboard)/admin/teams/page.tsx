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
import { Separator } from "@/components/ui/separator";
import { Plus, Pencil, Trash2, Users, UserPlus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";

type Manager = { id: string; name: string; email: string };
type Member = { id: string; name: string; email: string; role: Role };

type Team = {
  id: string;
  name: string;
  managerId: string;
  manager: Manager;
  memberCount?: number;
  members?: Member[];
  createdAt: string;
};

type User = { id: string; name: string; email: string; role: Role; teamId: string | null };

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamMembers, setTeamMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: "", managerId: "" });

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/teams");
      const json = await res.json();
      setTeams(json.data ?? []);
    } catch {
      toast.error("فشل تحميل الفرق");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/users");
    const json = await res.json();
    setAllUsers(json.data ?? []);
  }, []);

  useEffect(() => {
    loadTeams();
    loadUsers();
  }, [loadTeams, loadUsers]);

  const managers = allUsers.filter((u) => u.role === "SALES_MANAGER");

  function openCreate() {
    setForm({ name: "", managerId: "" });
    setCreateOpen(true);
  }

  function openEdit(team: Team) {
    setSelectedTeam(team);
    setForm({ name: team.name, managerId: team.managerId });
    setEditOpen(true);
  }

  async function openMembers(team: Team) {
    setSelectedTeam(team);
    setMembersOpen(true);
    const res = await fetch(`/api/teams/${team.id}`);
    const json = await res.json();
    setTeamMembers(json.data?.members ?? []);
  }

  async function handleCreate() {
    if (!form.name || !form.managerId) return toast.error("الاسم والمدير مطلوبان");
    setSaving(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success("تم إنشاء الفريق");
      setCreateOpen(false);
      loadTeams();
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!selectedTeam) return;
    if (!form.name || !form.managerId) return toast.error("الاسم والمدير مطلوبان");
    setSaving(true);
    try {
      const res = await fetch(`/api/teams/${selectedTeam.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
      toast.success("تم تحديث الفريق");
      setEditOpen(false);
      loadTeams();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(team: Team) {
    if (!confirm(`هل أنت متأكد من حذف فريق "${team.name}"؟`)) return;
    const res = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
    toast.success("تم حذف الفريق");
    loadTeams();
  }

  async function addMember(userId: string) {
    if (!selectedTeam) return;
    const res = await fetch(`/api/teams/${selectedTeam.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json = await res.json();
    if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
    toast.success("تمت إضافة العضو");
    openMembers(selectedTeam);
    loadUsers();
    loadTeams();
  }

  async function removeMember(userId: string) {
    if (!selectedTeam) return;
    const res = await fetch(`/api/teams/${selectedTeam.id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json = await res.json();
    if (!res.ok) return toast.error(json.error ?? "حدث خطأ");
    toast.success("تمت إزالة العضو");
    openMembers(selectedTeam);
    loadUsers();
    loadTeams();
  }

  // Users not in any team (or in this team) that can be added
  const memberIds = new Set(teamMembers.map((m) => m.id));
  const availableToAdd = allUsers.filter(
    (u) => !memberIds.has(u.id) && (u.teamId === null || u.teamId === selectedTeam?.id)
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الفرق</h1>
          <p className="text-gray-500 text-sm mt-1">إدارة فرق العمل وأعضاءها</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 ml-1" />
          إنشاء فريق
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : teams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">لا توجد فرق حتى الآن</p>
          <Button onClick={openCreate} className="mt-4" variant="outline">إنشاء أول فريق</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => (
            <div key={team.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{team.name}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">المدير: {team.manager.name}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(team)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(team)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-600">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">{team.memberCount ?? 0} عضو</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => openMembers(team)}>
                  <UserPlus className="w-3.5 h-3.5 ml-1" />
                  إدارة الأعضاء
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>إنشاء فريق جديد</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1">
              <Label>اسم الفريق *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="فريق المبيعات أ" />
            </div>
            <div className="grid gap-1">
              <Label>مدير الفريق *</Label>
              <Select value={form.managerId} onValueChange={(v) => setForm({ ...form, managerId: v ?? "" })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر مديراً" />
                </SelectTrigger>
                <SelectContent>
                  {managers.length === 0 ? (
                    <SelectItem value="none" disabled>لا يوجد مديرو مبيعات</SelectItem>
                  ) : (
                    managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>تعديل الفريق</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1">
              <Label>اسم الفريق *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>مدير الفريق *</Label>
              <Select value={form.managerId} onValueChange={(v) => setForm({ ...form, managerId: v ?? "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members Dialog */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>أعضاء فريق: {selectedTeam?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Current members */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">الأعضاء الحاليون ({teamMembers.length})</h4>
              {teamMembers.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">لا يوجد أعضاء</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {teamMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{member.name}</p>
                        <p className="text-xs text-gray-500">{ROLE_LABELS[member.role]}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-400 hover:text-red-600 h-7 w-7"
                        onClick={() => removeMember(member.id)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Add member */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">إضافة عضو</h4>
              {availableToAdd.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-2">لا يوجد موظفون متاحون للإضافة</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {availableToAdd.map((user) => (
                    <div key={user.id} className="flex items-center justify-between px-3 py-2 rounded-lg border hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-gray-500">{ROLE_LABELS[user.role]}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => addMember(user.id)}>
                        <UserPlus className="w-3.5 h-3.5 ml-1" />
                        إضافة
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setMembersOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

