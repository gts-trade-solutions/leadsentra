"use client";

import { Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Action = { label: string; onClick: () => void };

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  primary,
  secondary,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  primary?: Action;
  secondary?: Action;
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-10 text-center">
      <div className="mx-auto w-14 h-14 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
        <Icon className="w-7 h-7 text-gray-400" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
          {description}
        </p>
      )}

      {(primary || secondary) && (
        <div className="mt-5 flex items-center justify-center gap-3">
          {primary && (
            <button
              type="button"
              onClick={primary.onClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              + {primary.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm font-medium"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
