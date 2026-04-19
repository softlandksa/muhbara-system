"use client";

import { signOut, useSession } from "next-auth/react";
import { Menu, LogOut, User, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NotificationBell } from "./NotificationBell";
import { GlobalSearch } from "@/components/shared/GlobalSearch";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/types";

interface HeaderProps {
  onToggleSidebar: () => void;
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { data: session } = useSession();
  const user = session?.user;

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2) ?? "م";

  return (
    <header className="h-16 bg-card border-b border-border flex items-center gap-3 px-4 sticky top-0 z-40 shadow-[0_1px_0_0_var(--color-border)]" dir="rtl">
      {/* Toggle sidebar */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <Menu size={20} />
      </Button>

      {/* Search — takes remaining space */}
      <div className="flex-1 max-w-md">
        <GlobalSearch />
      </div>

      {/* Right-side actions */}
      <div className="flex items-center gap-1.5 mr-auto">
        <NotificationBell />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 hover:bg-muted rounded-lg px-2 py-1.5 transition-colors outline-none">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-foreground leading-tight">
                {user?.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {user?.role ? ROLE_LABELS[user.role as Role] : ""}
              </p>
            </div>
            <ChevronDown size={16} className="text-muted-foreground hidden sm:block" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" dir="rtl" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground font-normal">{user?.email}</p>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-muted-foreground gap-2">
              <User size={15} />
              الملف الشخصي
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/5 gap-2 font-medium"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={15} />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
