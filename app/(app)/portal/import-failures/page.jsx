'use client';

import SectionHeader from '@/components/SectionHeader';
import Table from '@/components/Table';
import { RefreshCw, Download, AlertCircle } from 'lucide-react';

export default function ImportFailuresPage() {
  const headers = ['File Name', 'Row', 'Error Reason', 'Date'];
  
  const failureData = [
    {
      fileName: 'contacts_q1.csv',
      row: '247',
      errorReason: 'Invalid email format: john@invalid',
      date: '2024-01-15'
    },
    {
      fileName: 'contacts_q1.csv',
      row: '392',
      errorReason: 'Missing required field: company',
      date: '2024-01-15'
    },
    {
      fileName: 'leads_export.csv',
      row: '156',
      errorReason: 'Phone number format invalid',
      date: '2024-01-14'
    },
    {
      fileName: 'prospects.csv',
      row: '89',
      errorReason: 'Duplicate email address',
      date: '2024-01-14'
    }
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Import Failures"
        description="Review and resolve contact import errors"
      >
        <button 
          onClick={() => alert('Export import failures functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Failures
        </button>
        <button 
          onClick={() => alert('Re-trying import functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Re-try Import
        </button>
      </SectionHeader>

      {/* Summary Card */}
      <div className="section-card">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <div>
            <h3 className="text-lg font-semibold text-white">Import Summary</h3>
            <p className="text-sm text-gray-400">Recent import errors that need attention</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-red-400 mb-1">4</div>
            <div className="text-sm text-gray-400">Failed Rows</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400 mb-1">3</div>
            <div className="text-sm text-gray-400">Files Affected</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400 mb-1">1,243</div>
            <div className="text-sm text-gray-400">Successfully Imported</div>
          </div>
        </div>
      </div>

      {/* Failure Details Table */}
      <Table headers={headers} data={failureData} />

      {/* Common Issues Help */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Common Import Issues</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-gray-700 rounded-lg">
            <div className="w-2 h-2 bg-red-400 rounded-full mt-2" />
            <div>
              <div className="font-medium text-white text-sm">Invalid Email Format</div>
              <div className="text-xs text-gray-400">Ensure emails follow standard format (user@domain.com)</div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-gray-700 rounded-lg">
            <div className="w-2 h-2 bg-yellow-400 rounded-full mt-2" />
            <div>
              <div className="font-medium text-white text-sm">Missing Required Fields</div>
              <div className="text-xs text-gray-400">Name, email, and company are required fields</div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-gray-700 rounded-lg">
            <div className="w-2 h-2 bg-blue-400 rounded-full mt-2" />
            <div>
              <div className="font-medium text-white text-sm">Duplicate Records</div>
              <div className="text-xs text-gray-400">Remove duplicate entries before importing</div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real import failure handling */}
          Import failure handling is using mock data. Connect to backend for real CSV processing.
        </p>
      </div>
    </div>
  );
}