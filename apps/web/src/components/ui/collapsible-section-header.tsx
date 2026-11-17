import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils";

const tones = {
  muted: { label: "text-sidebar-muted-foreground", line: "bg-sidebar-border/50" },
  emphasized: { label: "text-sidebar-foreground/80", line: "bg-sidebar-foreground/25" },
  accent: { label: "text-primary", line: "bg-primary/50" },
} as const;

export function CollapsibleSectionHeader({
  children,
  expanded,
  tone = "muted",
  variant = "default",
  accessory,
  ...buttonProps
}: Omit<ComponentProps<"button">, "className" | "style" | "aria-expanded"> & {
  expanded: boolean;
  tone?: keyof typeof tones;
  /** "shelf" is a small-caps divider whose count sits beside the label. */
  variant?: "default" | "panel" | "shelf";
  accessory?: ReactNode;
}) {
  const shelf = variant === "shelf";
  return (
    <button
      {...buttonProps}
      type="button"
      aria-expanded={expanded}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        shelf ? "text-2xs font-semibold tracking-wider uppercase" : "text-xs font-medium",
        variant === "panel" ? "ps-2 pe-2.5" : "px-2",
        tones[tone].label,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {shelf ? accessory : null}
      <span
        aria-hidden
        // A trailing count drops the rule so it doesn't read as a leader; a shelf keeps its count by the label.
        className={cn("h-px min-w-2 flex-1", tones[tone].line, accessory && !shelf && "invisible")}
      />
      {shelf ? null : accessory}
      <ChevronDownIcon
        aria-hidden
        className={cn("size-3 shrink-0 transition-transform", !expanded && "-rotate-90")}
      />
    </button>
  );
}

export function SectionHeaderStatus({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-3xs leading-none text-destructive-foreground">{children}</span>
  );
}
