'use client';

import SectionHeader from '@/components/SectionHeader';
import ChartArea from '@/components/ChartArea';
import Table from '@/components/Table';
import { Download, Calendar, Filter, FileText } from 'lucide-react';

export default function ReportingPage() {
  const reportData = [
    { name: 'Mon', revenue: 12500, leads: 45 },
    { name: 'Tue', revenue: 15200, leads: 52 },
    { name: 'Wed', revenue: 18900, leads: 67 },
    { name: 'Thu', revenue: 14300, leads: 48 },
    { name: 'Fri', revenue: 21100, leads: 73 },
    { name: 'Sat', revenue: 8900, leads: 28 },
    { name: 'Sun', revenue: 11200, leads: 35 },
  ];

  const headers = ['Report Name', 'Type', 'Last Generated', 'Status'];
  
  const savedReports = [
    {
      name: 'Weekly Sales Summary',
      type: 'Sales',
      lastGenerated: '2024-01-15',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Ready
        </span>
      ),
    },
    {
      name: 'Campaign Performance',
      type: 'Marketing',
      lastGenerated: '2024-01-14',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Ready
        </span>
      ),
    },
    {
      name: 'Lead Source Analysis',
      type: 'Analytics',
      lastGenerated: '2024-01-13',
      status: (
        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded-full text-xs font-medium">
          Generating
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Reporting"
        description="Generate comprehensive reports and export your data"
      >
        <button 
          onClick={() => alert('Report filters functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
        <button 
          onClick={() => alert('New report functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <FileText className="w-4 h-4" />
          New Report
        </button>
      </SectionHeader>

      {/* Report Controls */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Generate Report</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select 
            onChange={(e) => console.log('Report type:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>Report Type</option>
            <option>Sales Report</option>
            <option>Marketing Report</option>
            <option>Analytics Report</option>
          </select>
          <div className="relative">
            <input
              type="date"
              onChange={(e) => console.log('Start date:', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>
          <div className="relative">
            <input
              type="date"
              onChange={(e) => console.log('End date:', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>
          <button
            onClick={() => alert('Generating report...')}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Generate
          </button>
        </div>
      </div>

      {/* Performance Chart */}
      <ChartArea 
        data={reportData} 
        title="Performance Overview" 
      />

      {/* Saved Reports */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Saved Reports</h3>
        <Table headers={headers} data={savedReports} actions />
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for report generation and export */}
          Report generation is UI-only. Connect to backend for PDF/CSV export functionality.
        </p>
      </div>
    </div>
  );
}