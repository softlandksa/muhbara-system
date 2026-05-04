"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  RefreshCw, RotateCcw, Loader2,
  Clock, User, Mail, Shield, CalendarDays, Timer, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";
import { SyncSummaryModal, type SyncSummaryData } from "@/components/shared/SyncSummaryModal";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Arabic date helpers ──────────────────────────────────────────────────────

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function formatRelative(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "منذ ثوانٍ";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin === 1 ? "منذ دقيقة" : `منذ ${diffMin} دقيقة`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour === 1 ? "منذ ساعة" : `منذ ${diffHour} ساعات`;
  const diffDay = Math.floor(diffHour / 24);
  return diffDay === 1 ? "منذ يوم" : `منذ ${diffDay} أيام`;
}

function formatDate(date: Date): string {
  return `${date.getDate()} ${ARABIC_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTime(date: Date): string {
  const h24 = date.getHours();
  const min = String(date.getMinutes()).padStart(2, "0");
  const h12 = h24 % 12 || 12;
  return `${h12}:${min} ${h24 >= 12 ? "م" : "ص"}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type UpdatedBy = { name: string; email: string; role: string };

type SyncEntry = {
  id: string;
  finishedAt: string | null;
  status: string;
  triggeredBy: string;
  errorSummary: string | null;
  updatedBy: UpdatedBy | null;
} | null;

type SyncResultData = {
  importedCount: number;
  updatedCount: number;
  noChangeCount: number;
  skippedEmptyCount: number;
  duplicateCount: number;
  failedCount: number;
  deletedCount: number;
};

type SyncResponse = {
  data?: SyncResultData;
  error?: string;
  debug?: string;
};

// ─── Resync confirmation modal ────────────────────────────────────────────────

function ResyncConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div dir="rtl" className="w-full max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className="shrink-0 h-10 w-10 rounded-full bg-red-100 flex items-center justify-center mt-0.5">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">تأكيد إعادة المزامنة الكاملة</p>
            <p className="mt-1 text-xs text-gray-500">ستقوم هذه العملية بـ:</p>
            <ul className="mt-1.5 text-xs text-gray-600 space-y-1">
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                تحديث بيانات الطلبات الموجودة التي تغيرت في الجدول
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                إضافة الطلبات الجديدة
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                <span className="text-red-600 font-medium">
                  حذف الطلبات المستوردة التي لم تعد موجودة في الجدول
                </span>
              </li>
            </ul>
            <p className="mt-2 text-xs text-red-600 font-medium">لا يمكن التراجع عن الحذف.</p>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors shadow-sm"
          >
            نعم، إعادة المزامنة
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tooltip content shared between both cards ────────────────────────────────

function SyncTooltipContent({
  syncInfo,
  finishedAt,
}: {
  syncInfo: SyncEntry;
  finishedAt: Date;
}) {
  const isCron = syncInfo?.triggeredBy === "CRON";
  return (
    <div dir="rtl" className="flex flex-col text-xs w-full">
      {syncInfo?.updatedBy ? (
        <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-2">
          <div className="flex items-center gap-2">
            <User className="h-3 w-3 opacity-60 shrink-0" />
            <span className="font-semibold">{syncInfo.updatedBy.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="h-3 w-3 opacity-60 shrink-0" />
            <span dir="ltr" className="opacity-80">{syncInfo.updatedBy.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-3 w-3 opacity-60 shrink-0" />
            <span className="opacity-80">
              {ROLE_LABELS[syncInfo.updatedBy.role as Role] ?? syncInfo.updatedBy.role}
            </span>
          </div>
        </div>
      ) : isCron ? (
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
          <RefreshCw className="h-3 w-3 opacity-60 shrink-0" />
          <span className="font-semibold">جدولة تلقائية</span>
        </div>
      ) : null}

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-3 w-3 opacity-60 shrink-0" />
          <span className="opacity-80">{formatDate(finishedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Timer className="h-3 w-3 opacity-60 shrink-0" />
          <span className="opacity-80">{formatTime(finishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Individual sync card ─────────────────────────────────────────────────────

type SyncCardProps = {
  label: string;
  runningLabel: string;
  icon: React.ReactNode;
  accentColor: "green" | "red";
  statusLabel: string;
  syncInfo: SyncEntry;
  isRunning: boolean;
  disabled: boolean;
  onSync: () => void;
};

function SyncCard({
  label, runningLabel, icon, accentColor, statusLabel,
  syncInfo, isRunning, disabled, onSync,
}: SyncCardProps) {
  const finishedAt = syncInfo?.finishedAt ? new Date(syncInfo.finishedAt) : null;
  const isCron     = syncInfo?.triggeredBy === "CRON";
  const byLabel    = syncInfo?.updatedBy?.name ?? (isCron ? "جدولة تلقائية" : null);
  const hasFailed  = syncInfo?.status === "FAILED";
  const isGreen    = accentColor === "green";

  return (
    <div
      dir="rtl"
      className="flex flex-col gap-3 rounded-2xl bg-white border border-gray-100 shadow-sm p-4 min-w-[190px]"
    >
      {/* ── Button ── */}
      <button
        type="button"
        onClick={onSync}
        disabled={disabled}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl",
          "text-sm font-semibold text-white",
          "transition-all duration-200 ease-out",
          "active:scale-95",
          isGreen
            ? "bg-green-600"
            : "bg-red-600",
          !disabled && isGreen && "hover:bg-green-500 hover:scale-105 hover:shadow-lg hover:shadow-green-500/40",
          !disabled && !isGreen && "hover:bg-red-500 hover:scale-105 hover:shadow-lg hover:shadow-red-500/40",
          disabled && "opacity-60 cursor-not-allowed",
        )}
      >
        {isRunning
          ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          : icon}
        <span>{isRunning ? runningLabel : label}</span>
      </button>

      {/* ── Status ── */}
      {finishedAt && byLabel ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              className="flex flex-col items-start gap-0.5 cursor-default select-none bg-transparent border-0 p-0 text-start w-full"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0 opacity-70" />
                <span>{statusLabel}: {formatRelative(finishedAt)}</span>
              </span>
              <span className="text-[11px] text-gray-500 ps-[18px]">
                بواسطة: {byLabel}
              </span>
              {hasFailed && (
                <span className="text-[10px] font-medium text-red-500 ps-[18px]">
                  فشلت المزامنة الأخيرة
                </span>
              )}
            </TooltipTrigger>

            <TooltipContent
              side="bottom"
              align="end"
              className="p-0 max-w-72 overflow-hidden"
            >
              <SyncTooltipContent syncInfo={syncInfo} finishedAt={finishedAt} />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="text-[11px] text-gray-400">
          لا توجد مزامنة سابقة
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const RESYNC_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER"];

export function GoogleSheetSyncButton({
  onSyncDone,
}: {
  onSyncDone?: () => void;
}) {
  const [syncing, setSyncing]         = useState(false);
  const [activeMode, setActiveMode]   = useState<"update" | "resync" | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [summary, setSummary]         = useState<SyncSummaryData | null>(null);
  const queryClient                   = useQueryClient();
  const { data: session }             = useSession();

  const userRole  = session?.user?.role as Role | undefined;
  const canResync = userRole ? RESYNC_ROLES.includes(userRole) : false;

  const { data } = useQuery<{ update: SyncEntry; resync: SyncEntry }>({
    queryKey: ["google-sheets-last-sync"],
    queryFn: () => fetch("/api/google-sheets/last-sync").then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const updateInfo = data?.update ?? null;
  const resyncInfo = data?.resync ?? null;

  async function handleSync(mode: "update" | "resync") {
    if (syncing) return;
    setSyncing(true);
    setActiveMode(mode);
    try {
      const res = await fetch("/api/google-sheets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });

      const text  = await res.text();
      let json: SyncResponse = {};
      const looksJson = res.headers.get("content-type")?.includes("application/json")
        || text.trimStart().startsWith("{");
      if (looksJson) {
        try { json = JSON.parse(text); } catch { /* fall through */ }
      }

      if (!res.ok) {
        if (json.debug) console.error("[GoogleSheetSync] debug:", json.debug);
        if (!looksJson) console.error("[GoogleSheetSync] non-JSON", res.status, text.slice(0, 300));
        toast.error(json.error ?? `فشل التحديث — خطأ ${res.status}`);
        return;
      }

      if (json.data) {
        setSummary({
          mode,
          importedCount:     json.data.importedCount,
          updatedCount:      json.data.updatedCount,
          noChangeCount:     json.data.noChangeCount,
          duplicateCount:    json.data.duplicateCount,
          skippedEmptyCount: json.data.skippedEmptyCount,
          failedCount:       json.data.failedCount,
          deletedCount:      json.data.deletedCount,
          syncedAt:          new Date(),
          updatedBy:         null,
        });
      } else {
        toast.success("تم التحديث بنجاح");
      }

      await queryClient.invalidateQueries({ queryKey: ["google-sheets-last-sync"] });
      onSyncDone?.();
    } catch (err) {
      console.error("[GoogleSheetSync] network error:", err);
      toast.error("تعذر الاتصال بالخادم — تحقق من اتصالك");
    } finally {
      setSyncing(false);
      setActiveMode(null);
    }
  }

  return (
    <>
      {summary && (
        <SyncSummaryModal data={summary} onClose={() => setSummary(null)} />
      )}
      {showConfirm && (
        <ResyncConfirmModal
          onConfirm={() => { setShowConfirm(false); handleSync("resync"); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* ── Two independent cards, side by side ─────────────────────────── */}
      <div className="flex flex-wrap gap-4 items-start">

        <SyncCard
          label="تحديث البيانات"
          runningLabel="جاري التحديث..."
          icon={<RefreshCw className="h-4 w-4 shrink-0" />}
          accentColor="green"
          statusLabel="آخر تحديث"
          syncInfo={updateInfo}
          isRunning={syncing && activeMode === "update"}
          disabled={syncing}
          onSync={() => handleSync("update")}
        />

        {canResync && (
          <SyncCard
            label="إعادة المزامنة"
            runningLabel="جاري إعادة المزامنة..."
            icon={<RotateCcw className="h-4 w-4 shrink-0" />}
            accentColor="red"
            statusLabel="آخر إعادة مزامنة"
            syncInfo={resyncInfo}
            isRunning={syncing && activeMode === "resync"}
            disabled={syncing}
            onSync={() => setShowConfirm(true)}
          />
        )}

      </div>
    </>
  );
}
