"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  DIAL_CODES,
  CODES_BY_LENGTH,
  POPULAR_ISO,
  countryForCode,
  type DialCode,
} from "@/lib/dialCodes";

/**
 * Phone field with a country dial-code picker. The stored value remains a
 * single string (e.g. "+91 98765 43210"), so it drops into existing forms that
 * keep `phone` as one field — no schema/state changes needed.
 *
 * On change we emit `"<dialCode> <national>"`. When parsing an existing value,
 * a leading "+<code>" is matched against the known list to preselect it.
 *
 * The country list covers every ITU-T E.164 code (see lib/dialCodes.ts), which
 * is far too many for a native <select> squeezed to 80px — so the control is a
 * searchable dropdown instead: type a country name, an ISO code, or the digits.
 * The panel renders through a portal because these fields sit inside modals
 * with `overflow-y-auto`, which would otherwise clip it.
 */

export type { DialCode };
export { DIAL_CODES };

const DEFAULT_CODE = "+91";

/** Split a stored value into { code, national } using the known dial codes. */
function parse(value: string): { code: string; national: string } {
  const v = (value || "").trim();
  if (v.startsWith("+")) {
    // Longest matching code wins, so "+1876" resolves to Jamaica rather than
    // being swallowed by "+1".
    const match = CODES_BY_LENGTH.find((c) => v.startsWith(c));
    if (match) return { code: match, national: v.slice(match.length).trim() };
  }
  return { code: DEFAULT_CODE, national: v };
}

export default function PhoneInput({
  value,
  onChange,
  placeholder = "98765 43210",
  className = "",
  inputClassName = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const { code, national } = useMemo(() => parse(value), [value]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Several countries share one dial code (all of NANP is "+1"). Only the code
  // is persisted, so remember the user's pick for this session — otherwise
  // choosing "United States" would visibly snap back to "CA".
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => {
    if (pickedIso) {
      const byIso = DIAL_CODES.find((d) => d.iso === pickedIso);
      if (byIso && byIso.code === code) return byIso;
    }
    return countryForCode(code);
  }, [code, pickedIso]);

  const PANEL_WIDTH = 288; // w-72

  // Anchor the portal panel under the trigger. useLayoutEffect so the panel is
  // positioned before paint rather than flashing at 0,0.
  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), window.innerWidth - PANEL_WIDTH - 8);
    setRect({ left, top: r.bottom + 4, width: PANEL_WIDTH });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    searchRef.current?.focus();
    // capture:true so scrolling the modal body (not just the window) repositions.
    const onScrollOrResize = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const emit = (nextCode: string, nextNational: string) => {
    const n = nextNational.trim();
    onChange(n ? `${nextCode} ${n}` : nextCode);
  };

  /** Matches country name, ISO code, or the dial digits (with or without "+"). */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null; // null = show the pinned/full grouping instead
    const digits = q.replace(/^\+/, "");
    return DIAL_CODES.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.iso.toLowerCase() === q ||
        (digits && d.code.slice(1).startsWith(digits))
    );
  }, [query]);

  const popular = useMemo(
    () =>
      POPULAR_ISO.map((iso) => DIAL_CODES.find((d) => d.iso === iso)).filter(
        Boolean
      ) as DialCode[],
    []
  );

  const choose = (d: DialCode) => {
    setPickedIso(d.iso);
    emit(d.code, national);
    setOpen(false);
  };

  const base =
    "py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:border-emerald-600";

  const Option = ({ d }: { d: DialCode }) => {
    const active = selected?.iso === d.iso;
    return (
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => choose(d)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-700"
      >
        <span className="w-7 shrink-0 text-[11px] font-mono text-gray-500">{d.iso}</span>
        <span className="flex-1 truncate text-gray-200">{d.name}</span>
        <span className="shrink-0 text-xs text-gray-400 tabular-nums">{d.code}</span>
        {active && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
      </button>
    );
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Country dial code"
        title={selected ? `${selected.name} (${code})` : code}
        // Compact + fixed width so it doesn't crowd the number field in
        // narrow (e.g. 3-column) form grids. Shows just the ISO + dial code.
        className={`${base} w-[86px] shrink-0 px-1.5 text-sm flex items-center gap-1 hover:border-gray-600`}
      >
        <span className="flex-1 truncate text-left">
          {selected?.iso ?? "??"} {code}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
      </button>

      {open && rect && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
            // Above the z-50 modal overlays these fields live inside.
            className="z-[60] rounded-lg border border-gray-700 bg-gray-800 shadow-2xl"
          >
            <div className="flex items-center gap-2 px-2 py-2 border-b border-gray-700">
              <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Country, ISO or code…"
                className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
              />
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {results ? (
                results.length ? (
                  results.map((d) => <Option key={`${d.iso}-${d.code}`} d={d} />)
                ) : (
                  <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                )
              ) : (
                <>
                  <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                    Common
                  </div>
                  {popular.map((d) => <Option key={`pop-${d.iso}`} d={d} />)}
                  <div className="mt-1 px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-gray-500 border-t border-gray-700">
                    All countries
                  </div>
                  {DIAL_CODES.map((d) => <Option key={`${d.iso}-${d.code}`} d={d} />)}
                </>
              )}
            </div>
          </div>,
          document.body
        )}

      <input
        type="tel"
        value={national}
        onChange={(e) => emit(code, e.target.value)}
        placeholder={placeholder}
        // min-w-0 lets the flex item shrink below its content width instead of
        // overflowing the column.
        className={`${base} flex-1 min-w-0 px-3 ${inputClassName}`}
      />
    </div>
  );
}
