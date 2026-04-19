"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, ShoppingCart, Users, Package, Loader2 } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
type SearchResult = {
  orders: { id: string; orderNumber: string; customerName: string; phone: string; status: { name: string; color: string } }[];
  users: { id: string; name: string; email: string; role: string }[];
  products: { id: string; name: string; sku: string | null }[];
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+K opens the palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults(null); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open]);

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v);
    if (!v) { setQuery(""); setResults(null); }
  }, []);

  const go = useCallback((href: string) => {
    handleOpenChange(false);
    router.push(href);
  }, [handleOpenChange, router]);

  const hasResults = results && (
    results.orders.length > 0 || results.users.length > 0 || results.products.length > 0
  );

  return (
    <>
      {/* Trigger button in header */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors w-full"
      >
        <Search size={16} />
        <span className="flex-1 text-right">بحث... </span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-gray-400">
          Ctrl K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <div dir="rtl">
        <CommandInput
          placeholder="ابحث عن طلب، موظف، منتج..."
          value={query}
          onValueChange={setQuery}
          className="text-right"
        />
        <CommandList>
          {loading && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />جار البحث...
            </div>
          )}

          {!loading && query.length >= 2 && !hasResults && (
            <CommandEmpty>لا توجد نتائج لـ &quot;{query}&quot;</CommandEmpty>
          )}

          {!loading && query.length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              اكتب على الأقل حرفين للبحث
            </div>
          )}

          {!loading && results?.orders && results.orders.length > 0 && (
            <CommandGroup heading="الطلبات">
              {results.orders.map(order => (
                <CommandItem
                  key={order.id}
                  value={`order-${order.id}`}
                  onSelect={() => go(`/orders/${order.id}`)}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <ShoppingCart className="h-4 w-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{order.orderNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{order.customerName} · {order.phone}</p>
                  </div>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: order.status.color + "22", color: order.status.color }}
                  >
                    {order.status.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!loading && results?.users && results.users.length > 0 && (
            <>
              {results.orders.length > 0 && <CommandSeparator />}
              <CommandGroup heading="الموظفون">
                {results.users.map(user => (
                  <CommandItem
                    key={user.id}
                    value={`user-${user.id}`}
                    onSelect={() => go(`/admin/employees`)}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <Users className="h-4 w-4 text-purple-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{user.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {!loading && results?.products && results.products.length > 0 && (
            <>
              {(results.orders.length > 0 || results.users.length > 0) && <CommandSeparator />}
              <CommandGroup heading="المنتجات">
                {results.products.map(product => (
                  <CommandItem
                    key={product.id}
                    value={`product-${product.id}`}
                    onSelect={() => go(`/admin/settings`)}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <Package className="h-4 w-4 text-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{product.name}</p>
                      {product.sku && <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
        </div>
      </CommandDialog>
    </>
  );
}
