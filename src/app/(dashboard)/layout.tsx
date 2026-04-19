"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <div
        className={cn(
          "hidden md:flex flex-col shrink-0 sticky top-0 h-screen transition-all duration-300",
          sidebarCollapsed ? "w-20" : "w-70"
        )}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </div>

      {/* Mobile Sidebar - Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="p-0 w-72">
          <Sidebar collapsed={false} onClose={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleSidebar={() => {
            if (window.innerWidth < 768) {
              setMobileOpen(true);
            } else {
              setSidebarCollapsed((prev) => !prev);
            }
          }}
        />

        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
