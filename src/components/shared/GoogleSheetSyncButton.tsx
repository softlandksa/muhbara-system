"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

function formatExact(date: Date): string {
  const d = date.getDate();
  const m = ARABIC_MONTHS[date.getMonth()];
  const y = date.getFullYear();
  const h24 = date.getHours();
  const min = String(date.getMinutes()).padStart(2, "0");
  const h12 = h24 % 12 || 12;
  const ampm = h24 >= 12 ? "م" : "ص";
  return `${d} ${m} ${y} — ${h12}:${min} ${ampm}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type LastSyncInfo = {
  id: string;
  finishedAt: string;
  status: string;
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  failedCount: number;
  triggeredBy: string;
  errorSummary: string | null;
} | null;

type SyncResultData = {
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  failedCount: number;
};

type SyncResponse = {
  data?: SyncResultData;
  error?: string;
  debug?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function GoogleSheetSyncButton({
  onSyncDone,
}: {
  onSyncDone?: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery<{ data: LastSyncInfo }>({
    queryKey: ["google-sheets-last-sync"],
    queryFn: () => fetch("/api/google-sheets/last-sync").then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const last = data?.data;
  const finishedAt = last?.finishedAt ? new Date(last.finishedAt) : null;

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/google-sheets/sync", { method: "POST" });
      const json = (await res.json()) as SyncResponse;

      if (!res.ok) {
        if (json.debug) console.error("[GoogleSheetSync] server debug:", json.debug);
        toast.error(json.error ?? "فشل التحديث");
        return;
      }

      if (json.data) {
        const {
          totalSheets, sheetsSkipped, totalRows,
          importedCount, skippedCount, duplicateCount, failedCount,
        } = json.data;

        const parts: string[] = [
          `أوراق: ${totalSheets}${sheetsSkipped > 0 ? ` (متخطى: ${sheetsSkipped})` : ""}`,
          `صفوف: ${totalRows}`,
          `مستورد: ${importedCount}`,
        ];
        if (duplicateCount > 0) parts.push(`عملاء مكررين: ${duplicateCount}`);
        if (skippedCount > 0)   parts.push(`متخطى: ${skippedCount}`);
        if (failedCount > 0)    parts.push(`فاشل: ${failedCount}`);

        toast.success("تم تحديث البيانات بنجاح", {
          description: parts.join(" · "),
          duration: 7000,
        });
      } else {
        toast.success("تم تحديث البيانات بنجاح");
      }

      await queryClient.invalidateQueries({ queryKey: ["google-sheets-last-sync"] });
      onSyncDone?.();
    } catch (err) {
      console.error("[GoogleSheetSync] fetch error:", err);
      toast.error("تعذر الاتصال بالخادم — يرجى المحاولة مرة أخرى");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {/* ── Gradient sync button ───────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className={cn(
          // layout
          "relative inline-flex items-center gap-2 px-4 py-2 rounded-xl",
          // typography
          "text-sm font-semibold text-white",
          // gradient (blue-600 → violet-600, left-to-right visually)
          "bg-gradient-to-r from-blue-600 to-violet-600",
          // shadow
          "shadow-md shadow-blue-500/30",
          // hover
          "hover:shadow-lg hover:shadow-violet-500/40 hover:scale-105",
          // active feedback
          "active:scale-[0.98]",
          // smooth
          "transition-all duration-200 ease-out",
          // disabled
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "disabled:hover:scale-100 disabled:hover:shadow-md disabled:hover:shadow-blue-500/30"
        )}
        title="تحديث البيانات من Google Sheets"
      >
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          <RefreshCw className="h-4 w-4 shrink-0" />
        )}
        <span>{syncing ? "جاري التحديث..." : "تحديث البيانات"}</span>
      </button>

      {/* ── Last sync timestamp ────────────────────────────────────────────── */}
      {finishedAt && (
        <div className="hidden md:flex flex-col items-start leading-tight">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            {formatRelative(finishedAt)}
          </span>
          <span className="text-[10px] text-muted-foreground/70 mt-0.5">
            {formatExact(finishedAt)}
          </span>
          {last?.status === "FAILED" && (
            <span className="text-[10px] font-medium text-red-500 mt-0.5">
              فشلت المزامنة الأخيرة
            </span>
          )}
        </div>
      )}
    </div>
  );
}
