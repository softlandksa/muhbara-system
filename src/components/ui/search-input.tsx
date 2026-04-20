"use client";

import * as React from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  isSearching?: boolean;
}

function SearchInput({ value, onChange, isSearching, className, ...props }: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  // left cluster: X (outermost-left) then spinner just to its right
  const showClear = value.length > 0;
  const showSpinner = isSearching;
  // slot widths: X=24px, spinner=24px, gap=2px → reserve pl based on what's shown
  const leftPad = showClear && showSpinner ? "pl-14" : showClear || showSpinner ? "pl-8" : "pl-2.5";

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-lg border border-input bg-transparent transition-colors",
        "hover:border-ring hover:bg-muted/40",
        "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
        className
      )}
    >
      {/* Trailing icon — magnifier on physical right (RTL text start) */}
      <span className="pointer-events-none absolute right-2.5 flex shrink-0 text-muted-foreground">
        <Search className="h-4 w-4" />
      </span>

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-8 w-full min-w-0 bg-transparent py-1 text-base outline-none",
          "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "pr-9",
          leftPad
        )}
        {...props}
      />

      {/* Left icon cluster (physical left): spinner adjacent to X */}
      <span className="absolute left-1.5 flex items-center gap-0.5">
        {showSpinner && (
          <span className="flex shrink-0 text-muted-foreground pointer-events-none">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        {showClear && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="مسح البحث"
            className="flex shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </span>
    </div>
  );
}

export { SearchInput };
