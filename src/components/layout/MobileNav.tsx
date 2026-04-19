"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  MessageSquare,
  BarChart3,
} from "lucide-react";

const mobileNavItems = [
  {
    label: "الرئيسية",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["ADMIN", "SALES_MANAGER", "SALES", "SHIPPING", "FOLLOWUP"] as Role[],
  },
  {
    label: "الطلبات",
    href: "/orders",
    icon: ShoppingCart,
    roles: ["ADMIN", "SALES_MANAGER", "SALES"] as Role[],
  },
  {
    label: "الشحن",
    href: "/shipping",
    icon: Truck,
    roles: ["ADMIN", "SHIPPING"] as Role[],
  },
  {
    label: "المتابعة",
    href: "/follow-up",
    icon: MessageSquare,
    roles: ["ADMIN", "FOLLOWUP"] as Role[],
  },
  {
    label: "التقارير",
    href: "/reports/daily",
    icon: BarChart3,
    roles: ["ADMIN", "SALES_MANAGER", "SALES", "SHIPPING", "FOLLOWUP"] as Role[],
  },
];

export function MobileNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = session?.user?.role as Role | undefined;

  const visibleItems = mobileNavItems.filter(
    (item) => userRole && item.roles.includes(userRole)
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex items-center justify-around px-2 py-2 md:hidden">
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-1 rounded-lg transition-colors min-w-[56px]",
              isActive
                ? "text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Icon size={22} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
