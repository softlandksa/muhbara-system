"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { RefreshCw, RotateCcw, Loader2, Clock, User, Mail, Shield, CalendarDays, Timer, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";
import { SyncSummaryModal, type SyncSummaryData } from "@/components/shared/SyncSummaryModal";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
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

type LastSyncInfo = {
  id: string;
  finishedAt: string;
  status: string;
  mode: string;
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  noChangeCount: number;
  skippedEmptyCount: number;
  duplicateCount: number;
  failedCount: number;
  deletedCount: number;
  triggeredBy: string;
  updatedBy: UpdatedBy | null;
  errorSummary: string | null;
} | null;

type SyncResultData = {
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
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
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className="shrink-0 h-10 w-10 rounded-full bg-red-100 flex items-center justify-center mt-0.5">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">تأكيد إعادة المزامنة الكاملة</p>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
              ستقوم هذه العملية بـ:
            </p>
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
                  حذف الطلبات المستوردة من الجدول التي لم تعد موجودة فيه
                </span>
              </li>
            </ul>
            <p className="mt-2 text-xs text-red-600 font-medium">
              لا يمكن التراجع عن الحذف.
            </p>
          </div>
        </div>

        {/* Actions */}
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

// ─── Component ────────────────────────────────────────────────────────────────

const RESYNC_ROLES: Role[] = ["ADMIN", "GENERAL_MANAGER"];

export function GoogleSheetSyncButton({
  onSyncDone,
}: {
  onSyncDone?: () => void;
}) {
  const [syncing, setSyncing]           = useState(false);
  const [activeMode, setActiveMode]     = useState<"update" | "resync" | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [summary, setSummary]           = useState<SyncSummaryData | null>(null);
  const queryClient                     = useQueryClient();
  const { data: session }               = useSession();

  const userRole  = session?.user?.role as Role | undefined;
  const canResync = userRole ? RESYNC_ROLES.includes(userRole) : false;

  const { data } = useQuery<{ data: LastSyncInfo }>({
    queryKey: ["google-sheets-last-sync"],
    queryFn: () => fetch("/api/google-sheets/last-sync").then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const last       = data?.data;
  const finishedAt = last?.finishedAt ? new Date(last.finishedAt) : null;
  const isCron     = last?.triggeredBy === "CRON";
  const byLabel    = last?.updatedBy?.name ?? (isCron ? "جدولة تلقائية" : null);

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

      // Read as text first so a non-JSON crash response is handled gracefully
      const text = await res.text();
      let json: SyncResponse = {};
      const isJson = res.headers.get("content-type")?.includes("application/json");
      if (isJson || text.trimStart().startsWith("{")) {
        try { json = JSON.parse(text); } catch { /* fall through */ }
      }

      if (!res.ok) {
        if (json.debug) console.error("[GoogleSheetSync] server debug:", json.debug);
        if (!isJson && !text.trimStart().startsWith("{")) {
          console.error("[GoogleSheetSync] non-JSON response", res.status, text.slice(0, 300));
        }
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
      console.error("[GoogleSheetSync] fetch error:", err);
      toast.error("تعذر الاتصال بالخادم — يرجى المحاولة مرة أخرى");
    } finally {
      setSyncing(false);
      setActiveMode(null);
    }
  }

  const isUpdating = syncing && activeMode === "update";
  const isResyncing = syncing && activeMode === "resync";

  return (
    <>
      {summary && (
        <SyncSummaryModal data={summary} onClose={() => setSummary(null)} />
      )}

      {showConfirm && (
        <ResyncConfirmModal
          onConfirm={() => {
            setShowConfirm(false);
            handleSync("resync");
          }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div className="flex items-center gap-3">

        {/* ── Green update button ─────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => handleSync("update")}
          disabled={syncing}
          title="إضافة الطلبات الجديدة من Google Sheets"
          className={cn(
            "relative inline-flex items-center gap-2 px-4 py-2 rounded-xl",
            "text-sm font-semibold text-white",
            "bg-green-700",
            "shadow-md shadow-green-900/30",
            "hover:bg-green-600 hover:shadow-lg hover:shadow-green-500/40 hover:scale-[1.06]",
            "active:scale-[0.96]",
            "transition-all duration-200 ease-out",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            "disabled:hover:scale-100 disabled:hover:bg-green-700 disabled:hover:shadow-md disabled:hover:shadow-green-900/30",
          )}
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            <RefreshCw className="h-4 w-4 shrink-0" />
          )}
          <span>{isUpdating ? "جاري التحديث..." : "تحديث البيانات"}</span>
        </button>

        {/* ── Red resync button (admin/general-manager only) ───────────────────── */}
        {canResync && (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={syncing}
            title="مزامنة كاملة: تحديث + حذف الطلبات المحذوفة من الجدول"
            className={cn(
              "relative inline-flex items-center gap-2 px-4 py-2 rounded-xl",
              "text-sm font-semibold text-white",
              "bg-red-700",
              "shadow-md shadow-red-900/30",
              "hover:bg-red-600 hover:shadow-lg hover:shadow-red-500/40 hover:scale-[1.06]",
              "active:scale-[0.96]",
              "transition-all duration-200 ease-out",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "disabled:hover:scale-100 disabled:hover:bg-red-700 disabled:hover:shadow-md disabled:hover:shadow-red-900/30",
            )}
          >
            {isResyncing ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              <RotateCcw className="h-4 w-4 shrink-0" />
            )}
            <span>{isResyncing ? "جاري إعادة المزامنة..." : "إعادة المزامنة"}</span>
          </button>
        )}

        {/* ── Last sync info + tooltip ─────────────────────────────────────────── */}
        {finishedAt && byLabel && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                dir="rtl"
                className="hidden md:flex flex-col items-start cursor-default select-none bg-transparent border-0 p-0 m-0 text-start space-y-1"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>تم التحديث منذ: {formatRelative(finishedAt)}</span>
                </span>
                <span className="text-[11px] text-gray-500 pe-0.5">
                  بواسطة: {byLabel}
                </span>
                {last?.status === "FAILED" && (
                  <span className="text-[10px] font-medium text-red-500">
                    فشلت المزامنة الأخيرة
                  </span>
                )}
              </TooltipTrigger>

              <TooltipContent
                side="bottom"
                align="end"
                className="flex-col items-start gap-0 p-0 max-w-72 overflow-hidden"
              >
                <div dir="rtl" className="flex flex-col gap-0 text-xs w-full">

                  {/* User info block */}
                  {last?.updatedBy ? (
                    <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-2">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 opacity-60 shrink-0" />
                        <span className="font-semibold">{last.updatedBy.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3 opacity-60 shrink-0" />
                        <span dir="ltr" className="opacity-80">{last.updatedBy.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Shield className="h-3 w-3 opacity-60 shrink-0" />
                        <span className="opacity-80">
                          {ROLE_LABELS[last.updatedBy.role as Role] ?? last.updatedBy.role}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                      <RefreshCw className="h-3 w-3 opacity-60 shrink-0" />
                      <span className="font-semibold">جدولة تلقائية</span>
                    </div>
                  )}

                  {/* Divider */}
                  <div className="h-px bg-background/20 mx-0" />

                  {/* Date + time block */}
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
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

      </div>
    </>
  );
}
