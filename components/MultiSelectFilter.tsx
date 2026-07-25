"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

/**
 * A filter dropdown that holds many values and lets you find one by typing.
 *
 * The plain <select> filters it replaces became unusable once imports pushed
 * the option lists into the hundreds (every country, every segment) — a native
 * select has no search, and only one value could be active at a time.
 *
 * Selecting nothing means "all", which keeps the empty state identical to the
 * old behaviour.
 */
export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder = "All",
  searchPlaceholder = "Type to search…",
  id,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  // Selected values that no longer exist in `options` (e.g. the row they came
  // from was filtered out) still need to be togglable, so show them on top.
  const orphans = useMemo(
    () => selected.filter((s) => !options.includes(s)),
    [selected, options]
  );

  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]
    );
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div className="relative" ref={boxRef}>
      <label className="text-xs text-gray-400 block mb-1" htmlFor={id}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
      >
        <span className={`flex-1 truncate ${selected.length ? "text-gray-200" : "text-gray-500"}`}>
          {summary}
        </span>
        {selected.length > 0 && (
          <X
            className="w-3.5 h-3.5 text-gray-400 hover:text-white shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            aria-label={`Clear ${label} filter`}
          />
        )}
        <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[14rem] rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
          <div className="flex items-center gap-2 px-2 py-2 border-b border-gray-700">
            <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {orphans.map((value) => (
              <Option key={`orphan-${value}`} value={value} checked onToggle={toggle} muted />
            ))}
            {filtered.length === 0 && orphans.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
            ) : (
              filtered.map((value) => (
                <Option
                  key={value}
                  value={value}
                  checked={selected.includes(value)}
                  onToggle={toggle}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between px-2 py-1.5 border-t border-gray-700">
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-gray-400 hover:text-white px-2 py-1"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => onChange(Array.from(new Set([...selected, ...filtered])))}
              className="text-xs text-gray-400 hover:text-emerald-400 px-2 py-1"
            >
              Select {query.trim() ? "matches" : "all"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Option({
  value,
  checked,
  onToggle,
  muted,
}: {
  value: string;
  checked: boolean;
  onToggle: (v: string) => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={() => onToggle(value)}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-700"
    >
      <span
        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
          checked ? "bg-emerald-600 border-emerald-600" : "border-gray-600"
        }`}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </span>
      <span className={`truncate ${muted ? "text-gray-400 italic" : "text-gray-200"}`}>
        {value}
      </span>
    </button>
  );
}
