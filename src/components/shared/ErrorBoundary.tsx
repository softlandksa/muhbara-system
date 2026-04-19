"use client";

import React from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-6 text-center" dir="rtl">
          <p className="text-2xl mb-2">⚠️</p>
          <h2 className="text-lg font-semibold mb-1">حدث خطأ غير متوقع</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {this.state.error?.message ?? "يرجى المحاولة مرة أخرى"}
          </p>
          <Button onClick={() => this.setState({ hasError: false, error: null })}>
            إعادة المحاولة
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
