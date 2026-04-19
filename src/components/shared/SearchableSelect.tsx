"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
  group?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "اختر...",
  searchPlaceholder = "بحث...",
  disabled = false,
  error = false,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  // Determine if we have groups
  const hasGroups = options.some((o) => o.group != null);

  // Build ordered groups map preserving first-seen order
  const grouped: Map<string, Option[]> = new Map();
  if (hasGroups) {
    for (const opt of options) {
      const key = opt.group ?? "";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(opt);
    }
  }

  const renderItem = (option: Option) => (
    <CommandItem
      key={option.value}
      value={option.label}
      data-checked={value === option.value}
      onSelect={() => {
        onChange(option.value);
        setOpen(false);
      }}
    >
      <span className="flex-1">{option.label}</span>
      {option.sublabel && (
        <span className="text-xs text-muted-foreground ml-2">
          {option.sublabel}
        </span>
      )}
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          value === option.value ? "opacity-100" : "opacity-0"
        )}
      />
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive ring-3 ring-destructive/20",
          className
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            {hasGroups ? (
              Array.from(grouped.entries()).map(([groupName, groupOptions]) => (
                <CommandGroup key={groupName} heading={groupName}>
                  {groupOptions.map(renderItem)}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>
                {options.map(renderItem)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
