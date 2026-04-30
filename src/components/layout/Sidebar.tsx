"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";
import {
  LayoutDashboard,
  ShoppingCart,
  PlusCircle,
  Truck,
  MessageSquare,
  BarChart3,
  Users,
  DollarSign,
  UserCog,
  UsersRound,
  Calculator,
  Settings,
  Activity,
  ChevronDown,
  Bell,
  LogOut,
  ClipboardList,
  TrendingUp,
  Package,
  Target,
  Trophy,
  Radio,
} from "lucide-react";
import { useState, useEffect } from "react";

type NavItem = {
  label: string;
  href?: string;
  icon: React.ReactNode;
  roles: Role[];
  children?: NavItem[];
};

const navItems: NavItem[] = [
  {
    label: "لوحة التحكم",
    href: "/dashboard",
    icon: <LayoutDashboard size={20} />,
    roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR"],
  },
  {
    label: "الطلبات",
    href: "/orders",
    icon: <ShoppingCart size={20} />,
    roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT"],
  },
  {
    label: "إنشاء طلب",
    href: "/orders/new",
    icon: <PlusCircle size={20} />,
    roles: ["ADMIN", "SALES", "SUPPORT"],
  },
  {
    label: "الشحن",
    href: "/shipping",
    icon: <Truck size={20} />,
    roles: ["ADMIN", "SHIPPING"],
  },
  {
    label: "المتابعة",
    href: "/follow-up",
    icon: <MessageSquare size={20} />,
    roles: ["ADMIN", "FOLLOWUP"],
  },
  {
    label: "تقريري اليومي",
    href: "/reports/daily",
    icon: <ClipboardList size={20} />,
    roles: ["SALES", "SHIPPING", "SUPPORT", "FOLLOWUP"],
  },
  {
    label: "التقارير",
    icon: <BarChart3 size={20} />,
    roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR"] as Role[],
    children: [
      {
        label: "تقرير Live",
        href: "/reports/live",
        icon: <Radio size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT"],
      },
      {
        label: "تقارير المبيعات",
        href: "/reports/sales",
        icon: <BarChart3 size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"],
      },
      {
        label: "تقارير الأداء الفعلي",
        href: "/reports/actual-performance",
        icon: <TrendingUp size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"],
      },
      {
        label: "أداء الفرق",
        href: "/reports/teams",
        icon: <UsersRound size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"],
      },
      {
        label: "تقارير الموظفين",
        href: "/reports/employees",
        icon: <Users size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"],
      },
      {
        // Self-reports (التقارير الذاتية) are filled by FOLLOWUP employees only.
        // Managers/admin/HR can view in read-only mode.
        label: "التقارير الذاتية",
        href: "/reports/self-reports",
        icon: <ClipboardList size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "FOLLOWUP", "HR"],
      },
      {
        label: "العمولات",
        href: "/reports/commissions",
        icon: <DollarSign size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "HR"],
      },
      {
        label: "تقرير الشحن",
        href: "/reports/shipping",
        icon: <Truck size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SHIPPING"],
      },
      {
        label: "طلباتي",
        href: "/reports/my-orders",
        icon: <Package size={18} />,
        roles: ["SALES", "FOLLOWUP"],
      },
      {
        label: "التارجت",
        href: "/reports/targets",
        icon: <Target size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SHIPPING", "FOLLOWUP"],
      },
      {
        label: "الترتيب",
        href: "/reports/leaderboard",
        icon: <Trophy size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER"],
      },
    ],
  },
  {
    label: "الإشعارات",
    href: "/notifications",
    icon: <Bell size={20} />,
    roles: ["ADMIN", "GENERAL_MANAGER", "SALES_MANAGER", "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR"],
  },
  {
    label: "الإدارة",
    icon: <Settings size={20} />,
    roles: ["ADMIN", "GENERAL_MANAGER"],
    children: [
      {
        label: "الموظفين",
        href: "/admin/employees",
        icon: <UserCog size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER"],
      },
      {
        label: "الفرق",
        href: "/admin/teams",
        icon: <UsersRound size={18} />,
        roles: ["ADMIN"],
      },
      {
        label: "قواعد العمولات",
        href: "/admin/commissions",
        icon: <Calculator size={18} />,
        roles: ["ADMIN"],
      },
      {
        label: "التارجتات",
        href: "/admin/targets",
        icon: <Target size={18} />,
        roles: ["ADMIN", "GENERAL_MANAGER"],
      },
      {
        label: "الإعدادات",
        href: "/admin/settings",
        icon: <Settings size={18} />,
        roles: ["ADMIN"],
      },
      {
        label: "سجل النشاط",
        href: "/admin/activity-log",
        icon: <Activity size={18} />,
        roles: ["ADMIN"],
      },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onClose?: () => void;
}

export function Sidebar({ collapsed, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = session?.user?.role as Role | undefined;

  // Accordion: only one group open at a time — stored as a single string (or "")
  const [expandedGroup, setExpandedGroup] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const stored = localStorage.getItem("sidebar-expanded-group");
      if (stored && typeof stored === "string") return stored;
    } catch {
      // ignore
    }
    return "";
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    for (const item of navItems) {
      if (
        item.children?.some(
          (c) => c.href && (pathname === c.href || pathname.startsWith(c.href + "/"))
        )
      ) {
        setExpandedGroup(item.label);
        try { localStorage.setItem("sidebar-expanded-group", item.label); } catch { /* noop */ }
        return;
      }
    }
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleGroup = (label: string) => {
    setExpandedGroup((prev) => {
      const next = prev === label ? "" : label;
      try { localStorage.setItem("sidebar-expanded-group", next); } catch { /* noop */ }
      return next;
    });
  };

  const isVisible = (roles: Role[]) => {
    if (!userRole) return false;
    return roles.includes(userRole);
  };

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const handleLogout = () => {
    signOut({ callbackUrl: "/login" });
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-sidebar text-sidebar-foreground transition-all duration-300",
        collapsed ? "w-20" : "w-70"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 border-b border-sidebar-border h-16 shrink-0">
        <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shrink-0 font-bold text-lg text-primary-foreground">
          م
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="font-semibold text-sm leading-tight text-sidebar-foreground">نظام إدارة</p>
            <p className="text-sidebar-foreground/50 text-xs">الطلبات</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navItems.map((item) => {
          if (!isVisible(item.roles)) return null;

          // Group with children
          if (item.children) {
            const visibleChildren = item.children.filter((c) =>
              isVisible(c.roles)
            );
            if (visibleChildren.length === 0) return null;

            const isExpanded = expandedGroup === item.label;
            const hasActiveChild = visibleChildren.some((c) => isActive(c.href));

            return (
              <div key={item.label}>
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    hasActiveChild
                      ? "text-sidebar-foreground bg-sidebar-accent"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                    collapsed && "justify-center"
                  )}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-right">{item.label}</span>
                      <ChevronDown
                        size={16}
                        className={cn(
                          "transition-transform shrink-0",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </>
                  )}
                </button>

                {!collapsed && isExpanded && (
                  <div className="mt-1 ms-2 space-y-0.5 border-s border-sidebar-border ps-2">
                    {visibleChildren.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href!}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                          isActive(child.href)
                            ? "text-primary-foreground bg-primary"
                            : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                        )}
                      >
                        <span className="shrink-0">{child.icon}</span>
                        <span>{child.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // Single item
          return (
            <Link
              key={item.href}
              href={item.href!}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "text-primary-foreground bg-primary"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                collapsed && "justify-center"
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User info + Logout */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
        {!collapsed && session?.user && (
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{session.user.name}</p>
            <p className="text-xs text-sidebar-foreground/50 truncate">
              {userRole ? ROLE_LABELS[userRole] : ""}
            </p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-destructive/20",
            collapsed && "justify-center"
          )}
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>تسجيل الخروج</span>}
        </button>
      </div>
    </div>
  );
}
