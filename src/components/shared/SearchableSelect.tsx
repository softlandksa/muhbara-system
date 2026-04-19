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
  /** Text shown in the dropdown list; falls back to `label` when omitted */
  listLabel?: string;
  /** Hex/CSS color — renders a colored dot and tints the label text */
  color?: string;
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
  /** Render group headings bold/foreground and group items muted+indented */
  boldGroups?: boolean;
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
  boldGroups = false,
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

  const renderItem = (option: Option, isGrouped = false) => (
    <CommandItem
      key={option.value}
      value={option.label}
      data-checked={value === option.value}
      onSelect={() => {
        onChange(option.value);
        setOpen(false);
      }}
      className={isGrouped && !option.color ? "text-muted-foreground ms-2" : isGrouped ? "ms-2" : undefined}
    >
      {option.color && (
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0 flex-none"
          style={{ backgroundColor: option.color }}
        />
      )}
      <span
        className="flex-1"
        style={option.color ? { color: option.color } : undefined}
      >
        {option.listLabel ?? option.label}
      </span>
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
          "flex h-9 w-full cursor-pointer items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors",
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
                <CommandGroup
                  key={groupName}
                  heading={groupName}
                  className={
                    boldGroups
                      ? "**:[[cmdk-group-heading]]:!font-semibold **:[[cmdk-group-heading]]:!text-foreground **:[[cmdk-group-heading]]:!text-sm"
                      : undefined
                  }
                >
                  {groupOptions.map((o) => renderItem(o, boldGroups))}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>
                {options.map((o) => renderItem(o))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
