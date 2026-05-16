'use client';

import { formatCurrency } from '@/lib/utils';
import { User, DollarSign } from 'lucide-react';

export default function Kanban({ data }) {
  const columns = Object.keys(data);

  const getColumnColor = (column) => {
    const colors = {
      'New': 'border-blue-500',
      'Qualified': 'border-yellow-500',
      'Demo': 'border-purple-500',
      'Proposal': 'border-orange-500',
      'Won': 'border-emerald-500',
      'Lost': 'border-red-500',
    };
    return colors[column] || 'border-gray-500';
  };

  return (
    <div className="section-card">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {columns.map((column) => (
          <div key={column} className="min-h-[400px]">
            <div className={`border-t-4 ${getColumnColor(column)} bg-gray-800 rounded-t-lg`}>
              <div className="p-4 border-b border-gray-700">
                <h3 className="font-semibold text-white text-sm">{column}</h3>
                <p className="text-xs text-gray-400 mt-1">
                  {data[column].length} deals
                </p>
              </div>
            </div>
            
            <div className="bg-gray-800 rounded-b-lg border-l border-r border-b border-gray-700 p-2 min-h-[350px]">
              <div className="space-y-2">
                {data[column].map((item) => (
                  <div
                    key={item.id}
                    className="bg-gray-900 border border-gray-700 rounded-lg p-3 cursor-move hover:border-gray-600 transition-colors"
                  >
                    <h4 className="font-medium text-white text-sm mb-2 line-clamp-2">
                      {item.title}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <User className="w-3 h-3" />
                      {item.contact}
                    </div>
                    <div className="flex items-center gap-1 text-sm font-semibold text-emerald-400">
                      <DollarSign className="w-3 h-3" />
                      {formatCurrency(item.value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}