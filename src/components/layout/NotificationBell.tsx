"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  relatedOrderId: string | null;
  isRead: boolean;
  createdAt: string;
};

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["notifications-count"],
    queryFn: () => fetch("/api/notifications?unreadOnly=true&countOnly=true").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: listData } = useQuery<{ data: Notification[] }>({
    queryKey: ["notifications-list"],
    queryFn: () => fetch("/api/notifications").then(r => r.json()),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  const markAllRead = useMutation({
    mutationFn: () => fetch("/api/notifications", { method: "PUT" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => fetch(`/api/notifications/${id}`, { method: "PUT" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const unreadCount = countData?.count ?? 0;
  const notifications = listData?.data ?? [];

  const handleClick = (n: Notification) => {
    if (!n.isRead) markOneRead.mutate(n.id);
    if (n.relatedOrderId) {
      router.push(`/orders/${n.relatedOrderId}`);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">الإشعارات</span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                onClick={() => markAllRead.mutate()}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                تعيين الكل كمقروء
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
              لا توجد إشعارات
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map(n => (
                <button
                  key={n.id}
                  className={cn(
                    "w-full text-right px-4 py-3 hover:bg-muted/50 transition-colors",
                    !n.isRead && "bg-blue-50/50"
                  )}
                  onClick={() => handleClick(n)}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm leading-snug", !n.isRead && "font-medium")}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { locale: arSA, addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      {!n.isRead && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                      {n.relatedOrderId && <ExternalLink className="h-3 w-3 text-muted-foreground/50" />}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-4 py-2">
          <button
            className="w-full text-center text-xs text-primary hover:underline"
            onClick={() => { router.push("/notifications"); setOpen(false); }}
          >
            عرض كل الإشعارات
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
