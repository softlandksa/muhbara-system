"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppLoadingOverlayProps {
  open: boolean;
  message?: string;
  /** Use "fullscreen" for page-level operations, "inline" for dialog-level */
  mode?: "fullscreen" | "inline";
}

/**
 * A professional loading overlay for long-running operations.
 * - fullscreen (default): fixed overlay covering the whole viewport
 * - inline: absolute overlay covering the nearest relative container
 */
export function AppLoadingOverlay({
  open,
  message = "جاري المعالجة...",
  mode = "fullscreen",
}: AppLoadingOverlayProps) {
  if (!open) return null;

  return (
    <div
      dir="rtl"
      className={cn(
        "z-50 flex items-center justify-center backdrop-blur-sm bg-background/60",
        mode === "fullscreen" ? "fixed inset-0" : "absolute inset-0 rounded-inherit",
      )}
    >
      <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-background border shadow-xl">
        <div className="relative">
          {/* Outer ring */}
          <div className="h-14 w-14 rounded-full border-4 border-primary/20" />
          {/* Spinning arc */}
          <Loader2
            className="absolute inset-0 m-auto h-10 w-10 animate-spin text-primary"
            strokeWidth={2.5}
          />
        </div>
        <p className="text-sm font-medium text-foreground">{message}</p>
      </div>
    </div>
  );
}
