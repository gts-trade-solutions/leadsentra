'use client';

import { MoreHorizontal } from 'lucide-react';

export default function Table({ headers, data, actions }) {
  return (
    <div className="section-card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              {headers.map((header, index) => (
                <th key={index} className="text-left py-3 px-4 text-sm font-medium text-gray-400">
                  {header}
                </th>
              ))}
              {actions && (
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">
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