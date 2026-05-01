"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// ─── Arabic date formatting ───────────────────────────────────────────────────

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
  return diffHour === 1 ? "منذ ساعة" : `منذ ${diffHour} ساعات`;
}

function formatExact(date: Date): string {
  const d = date.getDate();
  const m = ARABIC_MONTHS[date.getMonth()];
  const y = date.getFullYear();
  const h24 = date.getHours();
  const min = String(date.getMinutes()).padStart(2, "0");
  const h12 = h24 % 12 || 12;
  const ampm = h24 >= 12 ? "م" : "ص";
  return `${d}-${m}-${y} ${h12}:${min} ${ampm}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type LastSyncInfo = {
  id: string;
  finishedAt: string;
  status: string;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  triggeredBy: string;
  errorSummary: string | null;
} | null;

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
      const json = (await res.json()) as {
        data?: { totalRows: number; importedCount: number; skippedCount: number; failedCount: number };
        error?: string;
      };

      if (!res.ok) {
        toast.error(json.error ?? "فشل التحديث");
        return;
      }

      if (json.data) {
        const { importedCount, skippedCount, failedCount, totalRows } = json.data;
        toast.success(
          `إجمالي الصفوف: ${totalRows} — مستورد: ${importedCount} · متخطى: ${skippedCount} · فاشل: ${failedCount}`
        );
      }

      await queryClient.invalidateQueries({ queryKey: ["google-sheets-last-sync"] });
      onSyncDone?.();
    } catch {
      toast.error("تعذر الاتصال بالخادم — يرجى المحاولة مرة أخرى");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncing}
        title="تحديث البيانات من Google Sheets"
      >
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin ml-1" />
        ) : (
          <RefreshCw className="h-4 w-4 ml-1" />
        )}
        تحديث البيانات
      </Button>

      <span className="text-xs text-muted-foreground hidden md:block whitespace-nowrap">
        {finishedAt
          ? `آخر تحديث: ${formatRelative(finishedAt)} — ${formatExact(finishedAt)}`
          : "لم يتم التحديث بعد"}
      </span>
    </div>
  );
}
