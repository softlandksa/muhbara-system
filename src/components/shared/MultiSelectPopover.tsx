"use client";

import { useState, useMemo, useRef } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface MultiSelectItem {
  id: string;
  name: string;
  color?: string;
}

interface MultiSelectPopoverProps {
  items: MultiSelectItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  emptyLabel: string;
  activeLabel: (count: number) => string;
  icon?: React.ReactNode;
  searchPlaceholder?: string;
  align?: "start" | "end" | "center";
}

export function MultiSelectPopover({
  items,
  selectedIds,
  onToggle,
  onClear,
  emptyLabel,
  activeLabel,
  icon,
  searchPlaceholder = "بحث...",
  align = "start",
}: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      search.trim()
        ? items.filter((i) => i.name.includes(search))
        : items,
    [items, search],
  );

  const label = selectedIds.size === 0 ? emptyLabel : activeLabel(selectedIds.size);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors min-w-[120px]",
          selectedIds.size > 0
            ? "border-primary bg-primary/10 text-primary"
            : "border-input text-foreground hover:bg-muted",
        )}
      >
        {icon}
        <span className="flex-1 text-right">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            ref={searchRef}
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground ps-0 pe-1"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); searchRef.current?.focus(); }}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="مسح البحث"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/80 hover:shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Checkbox
                checked={selectedIds.has(item.id)}
                onCheckedChange={() => onToggle(item.id)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
              />
              <span className="flex items-center gap-2 flex-1 text-right">
                {item.color && (
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                {item.name}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">لا توجد نتائج</p>
          )}
        </div>
        {selectedIds.size > 0 && (
          <div className="border-t p-2">
            <button
              type="button"
              onClick={() => { onClear(); setOpen(false); }}
              className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
            >
              مسح التحديد
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
