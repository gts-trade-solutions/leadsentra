"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info, CheckCircle2, AlertTriangle } from "lucide-react";

type Variant = "info" | "success" | "warning";

const STYLES: Record<Variant, { border: string; bg: string; title: string; icon: any }> = {
  info:    { border: "border-sky-800",     bg: "bg-sky-950/30",     title: "text-sky-200",     icon: Info },
  success: { border: "border-emerald-800", bg: "bg-emerald-950/30", title: "text-emerald-200", icon: CheckCircle2 },
  warning: { border: "border-amber-800",   bg: "bg-amber-950/30",   title: "text-amber-200",   icon: AlertTriangle },
};

export default function Instructions({
  title,
  variant = "info",
  defaultOpen = false,
  children,
}: {
  title: string;
  variant?: Variant;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const s = STYLES[variant];
  const Icon = s.icon;

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className={`flex items-center gap-2 text-sm font-semibold ${s.title}`}>
          <Icon className="w-4 h-4" />
          {title}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 text-sm text-gray-300 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
