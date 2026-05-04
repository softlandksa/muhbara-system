"use client";

import { X, CheckCircle2, RefreshCw, MinusCircle, AlertCircle, Ban, Inbox, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type SyncSummaryData = {
  mode: "update" | "resync";
  importedCount: number;
  updatedCount: number;
  noChangeCount: number;
  duplicateCount: number;
  skippedEmptyCount: number;
  failedCount: number;
  deletedCount: number;
  syncedAt: Date;
  updatedBy?: { name: string; email: string } | null;
};

type Props = {
  data: SyncSummaryData;
  onClose: () => void;
};

type StatRow = {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
};

function formatTime(d: Date): string {
  const h24 = d.getHours();
  const min  = String(d.getMinutes()).padStart(2, "0");
  const h12  = h24 % 12 || 12;
  return `${h12}:${min} ${h24 >= 12 ? "م" : "ص"}`;
}

const ARABIC_MONTHS = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];
function formatDate(d: Date): string {
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function SyncSummaryModal({ data, onClose }: Props) {
  const {
    mode,
    importedCount, updatedCount, noChangeCount,
    duplicateCount, skippedEmptyCount, failedCount, deletedCount,
    syncedAt, updatedBy,
  } = data;

  const isResync     = mode === "resync";
  const hasWarnings  = duplicateCount > 0 || failedCount > 0 || (isResync && deletedCount > 0);
  const totalActioned = importedCount + (isResync ? updatedCount : 0) + noChangeCount
    + duplicateCount + failedCount + (isResync ? deletedCount : 0);

  const rows: StatRow[] = [
    {
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: "طلبات جديدة",
      value: importedCount,
      color: "text-green-600",
      highlight: importedCount > 0,
    },
    ...(isResync ? [{
      icon: <RefreshCw className="h-4 w-4" />,
      label: "طلبات محدثة",
      value: updatedCount,
      color: "text-blue-600",
      highlight: updatedCount > 0,
    }] : []),
    {
      icon: <MinusCircle className="h-4 w-4" />,
      label: isResync ? "بدون تغيير" : "طلبات موجودة",
      value: noChangeCount,
      color: "text-gray-400",
    },
    ...(isResync ? [{
      icon: <Trash2 className="h-4 w-4" />,
      label: "طلبات محذوفة",
      value: deletedCount,
      color: "text-red-600",
      highlight: deletedCount > 0,
    }] : []),
    {
      icon: <Ban className="h-4 w-4" />,
      label: "مكررة",
      value: duplicateCount,
      color: "text-orange-500",
      highlight: duplicateCount > 0,
    },
    {
      icon: <Inbox className="h-4 w-4" />,
      label: "صفوف فارغة متجاهلة",
      value: skippedEmptyCount,
      color: "text-gray-400",
    },
    {
      icon: <AlertCircle className="h-4 w-4" />,
      label: "فشل",
      value: failedCount,
      color: "text-red-500",
      highlight: failedCount > 0,
    },
  ];

  const modeLabel = isResync ? "إعادة المزامنة" : "تحديث البيانات";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        dir="rtl"
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
      >
        {/* Header */}
        <div className={cn(
          "px-5 py-4 flex items-center justify-between",
          hasWarnings
            ? (isResync && deletedCount > 0 && !duplicateCount && !failedCount
                ? "bg-red-50 border-b border-red-100"
                : "bg-orange-50 border-b border-orange-100")
            : "bg-green-50 border-b border-green-100",
        )}>
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center",
              hasWarnings
                ? (isResync && deletedCount > 0 && !duplicateCount && !failedCount
                    ? "bg-red-100"
                    : "bg-orange-100")
                : "bg-green-100",
            )}>
              {hasWarnings
                ? (isResync && deletedCount > 0 && !duplicateCount && !failedCount
                    ? <Trash2 className="h-4 w-4 text-red-600" />
                    : <AlertCircle className="h-4 w-4 text-orange-600" />)
                : <CheckCircle2 className="h-4 w-4 text-green-600" />
              }
            </div>
            <div>
              <p className={cn(
                "text-sm font-bold",
                hasWarnings
                  ? (isResync && deletedCount > 0 && !duplicateCount && !failedCount ? "text-red-700" : "text-orange-700")
                  : "text-green-700",
              )}>
                ملخص {modeLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                {totalActioned} صف تمت معالجته
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-black/8 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stats grid */}
        <div className="px-5 py-4 grid grid-cols-2 gap-2">
          {rows.map((r, idx) => (
            <div
              key={r.label}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 border",
                // last item spans 2 cols when count is odd
                rows.length % 2 !== 0 && idx === rows.length - 1 && "col-span-2",
                r.highlight
                  ? "bg-white border-gray-200 shadow-sm"
                  : "bg-gray-50/60 border-gray-100",
              )}
            >
              <span className={cn("shrink-0", r.color)}>{r.icon}</span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground leading-tight truncate">{r.label}</p>
                <p className={cn(
                  "text-base font-bold leading-tight tabular-nums",
                  r.highlight ? r.color : "text-gray-500",
                )}>
                  {r.value.toLocaleString("ar")}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 pt-1 flex items-center justify-between text-xs text-muted-foreground border-t border-gray-100 mt-1">
          <span className="flex flex-col gap-0.5">
            <span>{formatDate(syncedAt)} — {formatTime(syncedAt)}</span>
            {updatedBy && (
              <span className="opacity-70">بواسطة {updatedBy.name}</span>
            )}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
