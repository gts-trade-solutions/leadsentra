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
/** An option whose stored value differs from what the user reads — e.g. a
 *  company, filtered by `company_id` but displayed by name. */
export type MultiSelectOption = { value: string; label: string };

/** Callers may pass plain strings (value === label) or {value,label} pairs. */
export type MultiSelectOptionInput = string | MultiSelectOption;

/** Tallest the scrolling list gets when there is room for it. */
const LIST_MAX = 256;
/** Shortest it may be squeezed to before the panel flips instead. */
const LIST_MIN = 120;
/** The search row and the Clear / Select-all row, which don't scroll. */
const PANEL_CHROME = 84;
/** Breathing room against the viewport edge. */
const EDGE_GAP = 12;

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
  options: MultiSelectOptionInput[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Where the panel opens, and how tall its list may be. Measured rather than
  // fixed: this filter sits in a row that can be anywhere down the page, and a
  // panel that always drops down runs off the bottom of the viewport when the
  // row is near it — the list scrolls, but Clear / Select all end up out of
  // reach below the fold.
  const [panel, setPanel] = useState({ up: false, maxList: LIST_MAX });
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Normalize both shapes to {value,label} once, so the search/toggle/summary
  // logic below never has to care which form the caller used.
  const items: MultiSelectOption[] = useMemo(
    () => options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
    [options]
  );

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

  // Re-measured on scroll and resize, not just on open: the page can move under
  // an open panel, and a panel that was measured against the old position would
  // then be the wrong height in the wrong place.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - EDGE_GAP;
      const above = rect.top - EDGE_GAP;
      // Flip only when going up genuinely helps — otherwise a filter in a short
      // viewport would flip to somewhere just as cramped.
      const up = below < LIST_MIN + PANEL_CHROME && above > below;
      const room = (up ? above : below) - PANEL_CHROME;
      setPanel({ up, maxList: Math.max(LIST_MIN, Math.min(LIST_MAX, room)) });
    };
    measure();
    window.addEventListener("resize", measure);
    // Capturing, so a scrolling ancestor counts and not just the window.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => o.label.toLowerCase().includes(q));
  }, [items, query]);

  // Selected values that no longer exist in `options` (e.g. the row they came
  // from was filtered out) still need to be togglable, so show them on top.
  const orphans = useMemo(
    () => selected.filter((s) => !items.some((o) => o.value === s)),
    [selected, items]
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
      ? items.find((o) => o.value === selected[0])?.label ?? selected[0]
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

      {/* z-40 clears the sticky action bars these filter rows sit above (they
          are z-30, and an equal z-index let the bar paint over the middle of
          this panel) while staying under the z-50 modals. */}
      {open && (
        <div
          className={`absolute z-40 w-full min-w-[14rem] rounded-lg border border-gray-700 bg-gray-800 shadow-xl ${
            panel.up ? "bottom-full mb-1" : "mt-1"
          }`}
        >
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

          <div className="overflow-y-auto py-1" style={{ maxHeight: panel.maxList }}>
            {orphans.map((value) => (
              <Option key={`orphan-${value}`} value={value} label={value} checked onToggle={toggle} muted />
            ))}
            {filtered.length === 0 && orphans.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
            ) : (
              filtered.map((o) => (
                <Option
                  key={o.value}
                  value={o.value}
                  label={o.label}
                  checked={selected.includes(o.value)}
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
              onClick={() =>
                onChange(Array.from(new Set([...selected, ...filtered.map((o) => o.value)])))
              }
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
  label,
  checked,
  onToggle,
  muted,
}: {
  value: string;
  label: string;
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
        {label}
      </span>
    </button>
  );
}
