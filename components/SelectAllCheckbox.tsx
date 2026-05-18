"use client";

import { useEffect, useRef } from "react";

/**
 * Header checkbox with the standard tri-state behaviour used in admin tables:
 *
 *   nothing selected → unchecked
 *   some selected    → indeterminate ("─" hash mark in most browsers)
 *   all selected     → checked
 *
 * The `indeterminate` property only lives on the DOM node — React doesn't
 * expose it as a prop — so we wire it through a ref-and-effect.
 */
export default function SelectAllCheckbox({
  allChecked,
  someChecked,
  onChange,
  ariaLabel = "Select all",
}: {
  allChecked: boolean;
  someChecked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someChecked && !allChecked;
  }, [allChecked, someChecked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allChecked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      title={
        allChecked
          ? "Clear selection"
          : someChecked
          ? "Select remaining rows"
          : "Select all rows"
      }
      className="cursor-pointer"
    />
  );
}
