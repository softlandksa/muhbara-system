"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * Renders a pair of circular navigation arrows with a page number in the middle.
 * Designed for RTL: ChevronRight = previous, ChevronLeft = next.
 */
export function PaginationArrows({ page, totalPages, onPrev, onNext }: Props) {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div className="flex items-center gap-3">
      <NavBtn onClick={onPrev} disabled={prevDisabled} label="السابق">
        <ChevronRight
          className={cn(
            "h-5 w-5 transition-colors duration-200 text-green-600",
            !prevDisabled && "group-hover:text-white",
          )}
        />
      </NavBtn>

      <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums text-foreground">
        {page}
      </span>

      <NavBtn onClick={onNext} disabled={nextDisabled} label="التالي">
        <ChevronLeft
          className={cn(
            "h-5 w-5 transition-colors duration-200 text-green-600",
            !nextDisabled && "group-hover:text-white",
          )}
        />
      </NavBtn>
    </div>
  );
}

function NavBtn({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Size & shape
        "group h-11 w-11 rounded-full flex items-center justify-center shrink-0",
        // Base style
        "bg-gray-100 shadow-sm",
        // Smooth transition for all properties
        "transition-all duration-200 ease-out",
        // Focus ring for keyboard accessibility
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1",
        // Enabled state
        !disabled && [
          "cursor-pointer",
          "hover:bg-green-600 hover:scale-[1.1] hover:shadow-lg hover:shadow-green-500/40",
          "active:scale-95",
        ],
        // Disabled state
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
