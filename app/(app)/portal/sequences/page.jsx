'use client';

import SectionHeader from '@/components/SectionHeader';
import Table from '@/components/Table';
import StatCard from '@/components/StatCard';
import { Plus, Filter, Play, Pause, Workflow, Users, TrendingUp } from 'lucide-react';

export default function SequencesPage() {
  const headers = ['Sequence Name', 'Steps', 'Active Contacts', 'Response Rate', 'Status'];
  
  const sequenceData = [
    {
      name: 'New Lead Nurture',
      steps: '5 steps',
      contacts: '1,247',
      responseRate: '12.3%',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Active
        </span>
      ),
    },
    {
      name: 'Product Demo Follow-up',
      steps: '3 steps',
      contacts: '456',
      responseRate: '18.7%',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Active
        </span>
      ),
    },
    {
      name: 'Cold Outreach - Enterprise',
      steps: '7 steps',
      contacts: '892',
      responseRate: '8.4%',
      status: (
        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded-full text-xs font-medium">
          Paused
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Email Sequences"
        description="Automate your outreach with intelligent email sequences"
      >
        <button 
          onClick={() => alert('Sequence filters functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
        <button 
          onClick={() => alert('Create sequence functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Sequence
        </button>
      </SectionHeader>

      {/* Sequence Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Sequences"
          value="12"
          icon={Workflow}
        />
        <StatCard
          title="Total Contacts"
          value="2,595"
          icon={Users}
        />
        <StatCard
          title="Avg Response Rate"
          value="13.1%"
          icon={TrendingUp}
          change="+2.3%"
          changeType="positive"
        />
        <StatCard
          title="Emails Sent Today"
          value="847"
          icon={TrendingUp}
        />
      </div>

      <Table headers={headers} data={sequenceData} actions />

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for sequence automation */}
          Email sequences are using mock data. Connect to backend for automated email workflows.
        </p>
      </div>
    </div>
  );
}