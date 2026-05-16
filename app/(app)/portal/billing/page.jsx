'use client';

import SectionHeader from '@/components/SectionHeader';
import Table from '@/components/Table';
import StatCard from '@/components/StatCard';
import { CreditCard, Download, DollarSign, Calendar } from 'lucide-react';

export default function BillingPage() {
  const headers = ['Invoice', 'Date', 'Amount', 'Status'];
  
  const invoiceData = [
    {
      invoice: '#INV-2024-001',
      date: '2024-01-01',
      amount: '$299.00',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Paid
        </span>
      ),
    },
    {
      invoice: '#INV-2023-012',
      date: '2023-12-01',
      amount: '$299.00',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Paid
        </span>
      ),
    },
    {
      invoice: '#INV-2023-011',
      date: '2023-11-01',
      amount: '$299.00',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Paid
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Billing & Subscription"
        description="Manage your subscription and billing information"
      />

      {/* Billing Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Current Plan"
          value="Professional"
          icon={CreditCard}
          badge="Active"
        />
        <StatCard
          title="Monthly Cost"
          value="$299"
          icon={DollarSign}
        />
        <StatCard
          title="Next Billing"
          value="Feb 1, 2024"
          icon={Calendar}
        />
        <StatCard
          title="Credits Used"
          value="8,247"
          icon={DollarSign}
          badge="of 10,000"
        />
      </div>

      {/* Current Plan */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Current Subscription</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="p-4 bg-emerald-600/10 border border-emerald-600/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-white">Professional Plan</h4>
                <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                  Current
                </span>
              </div>
              <div className="text-2xl font-bold text-white mb-2">$299<span className="text-sm text-gray-400">/month</span></div>
              <ul className="space-y-2 text-sm text-gray-300">
                <li>• 10,000 contact credits</li>
                <li>• Unlimited email campaigns</li>
                <li>• Advanced analytics</li>
                <li>• CRM integrations</li>
                <li>• Priority support</li>
              </ul>
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Payment Method</span>
                <span className="text-sm text-white">•••• •••• •••• 4242</span>
              </div>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Billing Cycle</span>
                <span className="text-sm text-white">Monthly</span>
              </div>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Next Billing Date</span>
                <span className="text-sm text-white">February 1, 2024</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => alert('Upgrade plan functionality')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Upgrade Plan
          </button>
          <button
            onClick={() => alert('Update payment method functionality')}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Update Payment
          </button>
        </div>
      </div>

      {/* Invoice History */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Invoice History</h3>
          <button
            onClick={() => alert('Download all invoices functionality')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download All
          </button>
        </div>
        <Table headers={headers} data={invoiceData} actions />
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for billing management */}
          Billing management is UI-only. Connect to backend for payment processing and subscription management.
        </p>
      </div>
    </div>
  );
}