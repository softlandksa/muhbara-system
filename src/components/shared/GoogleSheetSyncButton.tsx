"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, Clock, User, Mail, Shield, CalendarDays, Timer } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";
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
  totalSheets: number;
  sheetsSkipped: number;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  failedCount: number;
  triggeredBy: string;
  updatedBy: UpdatedBy | null;
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
  const isCron = last?.triggeredBy === "CRON";
  const byLabel = last?.updatedBy?.name ?? (isCron ? "جدولة تلقائية" : null);

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
        if (duplicateCount > 0) parts.push(`مكررون: ${duplicateCount}`);
        if (skippedCount > 0)   parts.push(`متخطى: ${skippedCount}`);
        if (failedCount > 0)    parts.push(`فاشل: ${failedCount}`);

        toast.success("تم التحديث بنجاح", {
          description: parts.join(" · "),
          duration: 7000,
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
    }
  }

  return (
    <div className="flex items-center gap-3">

      {/* ── Sync button ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        title="تحديث البيانات من Google Sheets"
        className={cn(
          "relative inline-flex items-center gap-2 px-4 py-2 rounded-xl",
          "text-sm font-semibold text-white",
          "bg-blue-600",
          "shadow-md shadow-blue-500/30",
          "hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/40 hover:scale-105",
          "active:scale-[0.97]",
          "transition-all duration-200 ease-out",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "disabled:hover:scale-100 disabled:hover:bg-blue-600 disabled:hover:shadow-md disabled:hover:shadow-blue-500/30",
        )}
      >
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          <RefreshCw className="h-4 w-4 shrink-0" />
        )}
        <span>{syncing ? "جاري التحديث..." : "تحديث البيانات"}</span>
      </button>

      {/* ── Last sync info + tooltip ─────────────────────────────────────────── */}
      {finishedAt && byLabel && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              dir="rtl"
              className="hidden md:flex flex-col items-start leading-tight cursor-default select-none bg-transparent border-0 p-0 m-0 text-start"
            >
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                {formatRelative(finishedAt)}
                <span className="text-muted-foreground/50 mx-0.5">•</span>
                <span>بواسطة: {byLabel}</span>
              </span>
              {last?.status === "FAILED" && (
                <span className="text-[10px] font-medium text-red-500 mt-0.5">
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
  );
}
