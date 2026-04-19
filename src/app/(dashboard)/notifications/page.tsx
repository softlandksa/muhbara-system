"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const TYPE_LABELS: Record<string, string> = {
  ORDER_STATUS: "حالة طلب", NEW_REPORT: "تقرير جديد",
  COMMISSION: "عمولة", SYSTEM: "نظام",
};
const TYPE_COLORS: Record<string, string> = {
  ORDER_STATUS: "bg-blue-100 text-blue-700", NEW_REPORT: "bg-purple-100 text-purple-700",
  COMMISSION: "bg-green-100 text-green-700", SYSTEM: "bg-gray-100 text-gray-700",
};

function NotificationsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const filter = searchParams.get("filter") ?? "all";

  const setFilter = (f: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("filter", f);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const qs = searchParams.toString();
  const { data, isLoading } = useQuery<{ data: Notification[] }>({
    queryKey: ["notifications-page", qs],
    queryFn: () => fetch(`/api/notifications?${qs}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  const markAll = useMutation({
    mutationFn: () => fetch("/api/notifications", { method: "PUT" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => fetch(`/api/notifications/${id}`, { method: "PUT" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-page"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const notifications = data?.data ?? [];
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleClick = (n: Notification) => {
    if (!n.isRead) markOne.mutate(n.id);
    if (n.relatedOrderId) router.push(`/orders/${n.relatedOrderId}`);
  };

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6" />الإشعارات
          {unreadCount > 0 && <Badge className="bg-red-500 text-white">{unreadCount}</Badge>}
        </h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            <CheckCheck className="h-4 w-4 ml-1" />تعيين الكل كمقروء
          </Button>
        )}
      </div>

      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">الكل</TabsTrigger>
          <TabsTrigger value="unread">غير مقروءة</TabsTrigger>
          <TabsTrigger value="read">مقروءة</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Bell className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>لا توجد إشعارات</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={cn(
                "rounded-lg border p-4 cursor-pointer hover:bg-muted/40 transition-colors",
                !n.isRead && "border-blue-200 bg-blue-50/30"
              )}
              onClick={() => handleClick(n)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {!n.isRead && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
                    <p className={cn("text-sm leading-snug", !n.isRead && "font-semibold")}>
                      {n.title}
                    </p>
                    <Badge variant="secondary" className={cn("text-xs", TYPE_COLORS[n.type] ?? "")}>
                      {TYPE_LABELS[n.type] ?? n.type}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{n.message}</p>
                  <Tooltip>
                    <TooltipTrigger className="text-xs text-muted-foreground/70 mt-1 cursor-default">
                      {formatDistanceToNow(new Date(n.createdAt), { locale: arSA, addSuffix: true })}
                    </TooltipTrigger>
                    <TooltipContent>
                      {format(new Date(n.createdAt), "dd/MM/yyyy HH:mm", { locale: arSA })}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {n.relatedOrderId && (
                    <ExternalLink className="h-4 w-4 text-muted-foreground/50" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
      <NotificationsInner />
    </Suspense>
  );
}
