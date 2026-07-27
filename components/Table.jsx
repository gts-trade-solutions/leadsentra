'use client';

import { MoreHorizontal } from 'lucide-react';

/**
 * @param maxHeight  Optional CSS length (e.g. "70vh"). When set, the table body
 *   scrolls inside the card instead of growing the page, and the header row
 *   sticks to the top so columns stay readable while scrolling. Left off, the
 *   table renders full-height exactly as before.
 *
 * `actions` and `maxHeight` carry defaults so they are inferred as optional —
 * this file is plain JS, and without them every call site is required to pass
 * all four props.
 */
export default function Table({ headers, data, actions = false, maxHeight = "" }) {
  const scrollable = Boolean(maxHeight);
  // Sticky cells need their own background or rows show through them, and with
  // border-collapse a sticky cell's own border doesn't paint reliably in
  // Chrome — hence the inset shadow standing in for the header rule.
  const headCell = scrollable
    ? "sticky top-0 z-10 bg-gray-800 shadow-[inset_0_-1px_0_#374151]"
    : "";

  return (
    <div className="section-card">
      <div
        className={`overflow-x-auto ${scrollable ? "overflow-y-auto custom-scrollbar" : ""}`}
        style={scrollable ? { maxHeight } : undefined}
      >
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              {headers.map((header, index) => (
                <th key={index} className={`text-left py-3 px-4 text-sm font-medium text-gray-400 ${headCell}`}>
                  {header}
                </th>
              ))}
              {actions && (
                <th className={`text-right py-3 px-4 text-sm font-medium text-gray-400 ${headCell}`}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                {Object.values(row).map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-3 px-4 text-sm text-gray-300">
                    {cell}
                  </td>
                ))}
                {actions && (
                  <td className="py-3 px-4 text-right">
                    <button 
                      onClick={() => alert(`Actions for row ${rowIndex + 1}`)}
                      className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}