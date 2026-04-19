/**
 * Design system tokens — Clarity-inspired enterprise dashboard.
 * Import these constants instead of writing Tailwind classes by hand so the
 * visual language stays consistent across every page.
 */

// ─── Layout shells ─────────────────────────────────────────────────────────────
export const pageHeaderClass = "flex items-center justify-between gap-4 mb-6";
export const pageTitleClass  = "text-xl font-semibold text-foreground tracking-tight";
export const pageSubtitleClass = "text-sm text-muted-foreground mt-0.5";
export const sectionLabelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

// ─── Cards ─────────────────────────────────────────────────────────────────────
export const cardClass       = "bg-card rounded-xl border border-border shadow-sm";
export const cardHeaderClass = "flex items-center justify-between gap-3 px-5 py-4 border-b border-border";
export const cardTitleClass  = "text-sm font-semibold text-foreground";
export const cardBodyClass   = "p-5";

// ─── KPI numbers ───────────────────────────────────────────────────────────────
export const kpiValueClass = "text-3xl font-bold tracking-tight text-foreground";
export const kpiLabelClass = "text-xs font-medium text-muted-foreground uppercase tracking-wide";

// ─── Tables ────────────────────────────────────────────────────────────────────
export const tableContainerClass = "rounded-xl border border-border overflow-hidden bg-card";
export const tableRowHoverClass  = "hover:bg-muted/40 transition-colors";

// ─── Inputs ────────────────────────────────────────────────────────────────────
export const inputClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm " +
  "placeholder:text-muted-foreground focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors";

// ─── Buttons ───────────────────────────────────────────────────────────────────
export const primaryButtonClass =
  "inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary " +
  "text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors";

export const secondaryButtonClass =
  "inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border " +
  "bg-background text-sm font-medium hover:bg-muted transition-colors";

export const destructiveButtonClass =
  "inline-flex items-center gap-2 h-9 px-4 rounded-md border border-destructive/40 " +
  "text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors";

// ─── Chart helpers ─────────────────────────────────────────────────────────────
export const chartTooltipClass =
  "bg-card border border-border rounded-lg shadow-md p-3 text-sm min-w-[130px]";

// Consistent brand palette for charts (maps to CSS --chart-* vars at runtime)
export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

// ─── Empty / error states ───────────────────────────────────────────────────────
export const emptyStateClass =
  "flex flex-col items-center justify-center py-16 text-center gap-3";
export const emptyStateIconClass = "h-10 w-10 text-muted-foreground/40";
export const emptyStateTitleClass = "text-sm font-medium text-muted-foreground";
export const emptyStateSubtitleClass = "text-xs text-muted-foreground/70 max-w-xs";

// ─── Spacing scale (for reference only) ────────────────────────────────────────
// 4 / 6 / 8 / 12 / 16 — use Tailwind gap-*/p-*/m-* with these multiples
