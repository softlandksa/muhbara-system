"use client";

import { X, Truck, RefreshCw, MinusCircle, AlertCircle, Inbox, PackageX } from "lucide-react";
import { cn } from "@/lib/utils";

export type ShippingSyncSummaryData = {
  totalRows: number;
  updatedCount: number;
  noChangeCount: number;
  skippedEmptyCount: number;
  notFoundCount: number;
  failedCount: number;
  syncedAt: Date;
  updatedBy?: { name: string; email: string } | null;
};

type Props = {
  data: ShippingSyncSummaryData;
  onClose: () => void;
};

const ARABIC_MONTHS = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];

function formatDate(d: Date): string {
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(d: Date): string {
  const h24 = d.getHours();
  const min  = String(d.getMinutes()).padStart(2, "0");
  const h12  = h24 % 12 || 12;
  return `${h12}:${min} ${h24 >= 12 ? "م" : "ص"}`;
}

export function ShippingSyncSummaryModal({ data, onClose }: Props) {
  const {
    updatedCount, noChangeCount, skippedEmptyCount,
    notFoundCount, failedCount, syncedAt, updatedBy,
  } = data;

  const hasWarnings = failedCount > 0 || notFoundCount > 0;

  const rows = [
    {
      icon: <Truck className="h-4 w-4" />,
      label: "طلبات محدّثة",
      value: updatedCount,
      color: "text-amber-600",
      highlight: updatedCount > 0,
    },
    {
      icon: <MinusCircle className="h-4 w-4" />,
      label: "بدون تغيير",
      value: noChangeCount,
      color: "text-gray-400",
      highlight: false,
    },
    {
      icon: <PackageX className="h-4 w-4" />,
      label: "طلبات غير موجودة",
      value: notFoundCount,
      color: "text-orange-500",
      highlight: notFoundCount > 0,
    },
    {
      icon: <Inbox className="h-4 w-4" />,
      label: "صفوف فارغة متجاهلة",
      value: skippedEmptyCount,
      color: "text-gray-400",
      highlight: false,
    },
    {
      icon: <AlertCircle className="h-4 w-4" />,
      label: "أخطاء التحديث",
      value: failedCount,
      color: "text-red-500",
      highlight: failedCount > 0,
    },
  ];

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
            ? "bg-orange-50 border-b border-orange-100"
            : "bg-amber-50 border-b border-amber-100",
        )}>
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center",
              hasWarnings ? "bg-orange-100" : "bg-amber-100",
            )}>
              {hasWarnings
                ? <AlertCircle className="h-4 w-4 text-orange-600" />
                : <RefreshCw className="h-4 w-4 text-amber-600" />
              }
            </div>
            <div>
              <p className={cn(
                "text-sm font-bold",
                hasWarnings ? "text-orange-700" : "text-amber-700",
              )}>
                ملخص تحديث الشحن
              </p>
              <p className="text-xs text-muted-foreground">
                {updatedCount} طلب تم تحديثه
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
