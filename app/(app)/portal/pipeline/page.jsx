'use client';

import SectionHeader from '@/components/SectionHeader';
import Kanban from '@/components/Kanban';
import StatCard from '@/components/StatCard';
import { mockPipelineData } from '@/lib/mock';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, DollarSign, Target, Award } from 'lucide-react';

export default function PipelinePage() {
  // Calculate pipeline stats
  const totalDeals = Object.values(mockPipelineData).flat().length;
  const totalValue = Object.values(mockPipelineData)
    .flat()
    .reduce((sum, deal) => sum + deal.value, 0);
  const wonDeals = mockPipelineData['Won'] || [];
  const wonValue = wonDeals.reduce((sum, deal) => sum + deal.value, 0);

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Sales Pipeline"
        description="Track and manage your sales opportunities through each stage"
      />

      {/* Pipeline Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Deals"
          value={totalDeals.toString()}
          icon={Target}
        />
        <StatCard
          title="Pipeline Value"
          value={formatCurrency(totalValue)}
          icon={DollarSign}
        />
        <StatCard
          title="Won This Month"
          value={wonDeals.length.toString()}
          icon={Award}
          change="+12.5%"
          changeType="positive"
        />
        <StatCard
          title="Revenue Won"
          value={formatCurrency(wonValue)}
          icon={TrendingUp}
          change="+34.2%"
          changeType="positive"
        />
      </div>

      {/* Pipeline Kanban */}
      <Kanban data={mockPipelineData} />

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real pipeline data and drag-and-drop functionality */}
          Pipeline view is read-only. Connect to backend for full CRM functionality.
        </p>
      </div>
    </div>
  );
}