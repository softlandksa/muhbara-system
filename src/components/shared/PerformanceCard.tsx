"use client";

import {
  UsersRound, Users, TrendingUp, Clock,
  CheckCircle, Truck, RotateCcw, XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

// ─── Shared stats shape ───────────────────────────────────────────────────────

export type PerformanceStats = {
  totalOrders: number;
  delivered: number;
  shipped: number;
  returned: number;
  cancelled: number;
  deliveryRate: number;
  revenueByCurrency: { currencyCode: string; total: number }[];
};

// ─── Discriminated variant props ──────────────────────────────────────────────

type TeamVariant = {
  variant: "team";
  name: string;
  managerName: string;
  memberCount: number;
};

type EmployeeVariant = {
  variant: "employee";
  name: string;
  role: Role;
  teamName: string | null;
  lastOrderDate: string | null;
};

export type PerformanceCardProps = (TeamVariant | EmployeeVariant) &
  PerformanceStats & {
    onClick: () => void;
  };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rateColors(rate: number, highThreshold: number, midThreshold: number) {
  if (rate >= highThreshold) return { bar: "bg-green-500",  text: "text-green-600",  border: "border-green-400"  };
  if (rate >= midThreshold)  return { bar: "bg-yellow-400", text: "text-yellow-600", border: "border-yellow-400" };
  return                            { bar: "bg-red-400",    text: "text-red-500",    border: "border-red-400"    };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PerformanceCard(props: PerformanceCardProps) {
  const { variant, onClick,
    totalOrders, delivered, shipped, returned, cancelled,
    deliveryRate, revenueByCurrency,
  } = props;

  // Teams use 80/50 thresholds; employees use 70/40
  const thresholds = variant === "team" ? [80, 50] : [70, 40];
  const colors = rateColors(deliveryRate, thresholds[0], thresholds[1]);

  // ── Header ──
  const header =
    variant === "team" ? (
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <UsersRound className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="font-bold truncate">{props.name}</p>
            <p className="text-xs text-muted-foreground">المدير: {props.managerName}</p>
          </div>
        </div>
        <div className="text-center shrink-0">
          <p className="text-3xl font-bold leading-none">{totalOrders}</p>
          <p className="text-xs text-muted-foreground mt-0.5">طلب</p>
        </div>
      </div>
    ) : (() => {
      const initials = props.name.split(" ").map((n) => n[0]).join("").slice(0, 2);
      return (
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className={cn("font-bold text-white text-sm", colors.bar)}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{props.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[props.role]}</p>
            {props.teamName && <p className="text-xs text-muted-foreground">{props.teamName}</p>}
          </div>
          <div className="text-center shrink-0">
            <p className="text-2xl font-bold">{totalOrders}</p>
            <p className="text-xs text-muted-foreground">طلب</p>
          </div>
        </div>
      );
    })();

  return (
    <Card
      className={cn(
        "cursor-pointer border-2 transition-all duration-200 hover:shadow-lg hover:scale-[1.02]",
        colors.border,
      )}
      onClick={onClick}
    >
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        {header}

        {/* Member count (team only) */}
        {variant === "team" && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{props.memberCount} موظف نشط</span>
          </div>
        )}

        {/* Delivery rate bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">معدل التوصيل</span>
            <span className={cn("font-semibold", colors.text)}>{deliveryRate}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", colors.bar)}
              style={{ width: `${Math.min(deliveryRate, 100)}%` }}
            />
          </div>
        </div>

        {/* Status counts */}
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            { label: "توصيل", value: delivered, color: "text-green-600",  icon: <CheckCircle className="h-3 w-3 mx-auto mb-0.5" /> },
            { label: "شحن",   value: shipped,   color: "text-yellow-600", icon: <Truck       className="h-3 w-3 mx-auto mb-0.5" /> },
            { label: "مرتجع", value: returned,  color: "text-orange-500", icon: <RotateCcw   className="h-3 w-3 mx-auto mb-0.5" /> },
            { label: "ملغي",  value: cancelled, color: "text-red-500",    icon: <XCircle     className="h-3 w-3 mx-auto mb-0.5" /> },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-muted/40 py-1.5">
              <div className={cn("text-[10px] text-muted-foreground", s.color)}>{s.icon}</div>
              <p className={cn("text-base font-bold leading-none", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Per-currency revenue */}
        {revenueByCurrency.length > 0 && (
          <div className="pt-2 border-t space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>إجمالي المبيعات</span>
            </div>
            {revenueByCurrency.map((r) => (
              <div key={r.currencyCode} className="flex justify-between text-sm">
                <span className="text-muted-foreground font-mono">{r.currencyCode}</span>
                <span className="font-semibold">{r.total.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Last order (employee only) */}
        {variant === "employee" && props.lastOrderDate && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              آخر طلب:{" "}
              {formatDistanceToNow(new Date(props.lastOrderDate), { locale: arSA, addSuffix: true })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
