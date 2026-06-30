"use client";

import { useMemo } from "react";

/**
 * Phone field with a country dial-code dropdown. The stored value remains a
 * single string (e.g. "+91 98765 43210"), so it drops into existing forms that
 * keep `phone` as one field — no schema/state changes needed.
 *
 * On change we emit `"<dialCode> <national>"`. When parsing an existing value,
 * a leading "+<code>" is matched against the known list to preselect it.
 */

export type DialCode = { code: string; label: string; iso: string };

// Common dial codes (India-first, since this app is India-centric). Extend freely.
export const DIAL_CODES: DialCode[] = [
  { code: "+91", iso: "IN", label: "India (+91)" },
  { code: "+1", iso: "US", label: "USA/Canada (+1)" },
  { code: "+44", iso: "GB", label: "UK (+44)" },
  { code: "+971", iso: "AE", label: "UAE (+971)" },
  { code: "+966", iso: "SA", label: "Saudi Arabia (+966)" },
  { code: "+65", iso: "SG", label: "Singapore (+65)" },
  { code: "+61", iso: "AU", label: "Australia (+61)" },
  { code: "+60", iso: "MY", label: "Malaysia (+60)" },
  { code: "+66", iso: "TH", label: "Thailand (+66)" },
  { code: "+86", iso: "CN", label: "China (+86)" },
  { code: "+81", iso: "JP", label: "Japan (+81)" },
  { code: "+82", iso: "KR", label: "South Korea (+82)" },
  { code: "+92", iso: "PK", label: "Pakistan (+92)" },
  { code: "+880", iso: "BD", label: "Bangladesh (+880)" },
  { code: "+94", iso: "LK", label: "Sri Lanka (+94)" },
  { code: "+977", iso: "NP", label: "Nepal (+977)" },
  { code: "+49", iso: "DE", label: "Germany (+49)" },
  { code: "+33", iso: "FR", label: "France (+33)" },
  { code: "+39", iso: "IT", label: "Italy (+39)" },
  { code: "+34", iso: "ES", label: "Spain (+34)" },
  { code: "+31", iso: "NL", label: "Netherlands (+31)" },
  { code: "+41", iso: "CH", label: "Switzerland (+41)" },
  { code: "+7", iso: "RU", label: "Russia (+7)" },
  { code: "+55", iso: "BR", label: "Brazil (+55)" },
  { code: "+52", iso: "MX", label: "Mexico (+52)" },
  { code: "+27", iso: "ZA", label: "South Africa (+27)" },
  { code: "+234", iso: "NG", label: "Nigeria (+234)" },
  { code: "+254", iso: "KE", label: "Kenya (+254)" },
  { code: "+64", iso: "NZ", label: "New Zealand (+64)" },
];

const DEFAULT_CODE = "+91";

/** Split a stored value into { code, national } using the known dial codes. */
function parse(value: string): { code: string; national: string } {
  const v = (value || "").trim();
  if (v.startsWith("+")) {
    // Longest matching code wins (so +91 isn't shadowed by +9...).
    const match = [...DIAL_CODES]
      .map((d) => d.code)
      .sort((a, b) => b.length - a.length)
      .find((c) => v.startsWith(c));
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

  const emit = (nextCode: string, nextNational: string) => {
    const n = nextNational.trim();
    onChange(n ? `${nextCode} ${n}` : nextCode);
  };

  const base =
    "py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:border-emerald-600";

  return (
    <div className={`flex gap-2 ${className}`}>
      <select
        aria-label="Country dial code"
        title="Country dial code"
        value={code}
        onChange={(e) => emit(e.target.value, national)}
        // Compact + fixed width so it doesn't crowd the number field in
        // narrow (e.g. 3-column) form grids. Shows just the dial code.
        className={`${base} w-[80px] shrink-0 px-1.5 text-sm`}
      >
        {DIAL_CODES.map((d) => (
          <option key={`${d.iso}-${d.code}`} value={d.code} title={d.label}>
            {d.iso} {d.code}
          </option>
        ))}
      </select>
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
