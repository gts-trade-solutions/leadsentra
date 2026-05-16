'use client';

import SectionHeader from '@/components/SectionHeader';
import ChartArea from '@/components/ChartArea';
import StatCard from '@/components/StatCard';
import Table from '@/components/Table';
import { mockChartData, mockCampaigns } from '@/lib/mock';
import { BarChart3, TrendingUp, Users, Mail, Download } from 'lucide-react';

export default function AnalyticsPage() {
  const headers = ['Metric', 'Current Period', 'Previous Period', 'Change'];
  
  const analyticsData = [
    { metric: 'Email Open Rate', current: '23.4%', previous: '21.2%', change: '+2.2%' },
    { metric: 'Click Through Rate', current: '4.7%', previous: '4.1%', change: '+0.6%' },
    { metric: 'Conversion Rate', current: '2.8%', previous: '2.3%', change: '+0.5%' },
    { metric: 'Bounce Rate', current: '1.2%', previous: '1.8%', change: '-0.6%' },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Analytics & Insights"
        description="Track performance metrics and identify growth opportunities"
      >
        <button 
          onClick={() => alert('Export analytics report functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </SectionHeader>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Campaigns"
          value="24"
          icon={Mail}
          change="+3"
          changeType="positive"
        />
        <StatCard
          title="Total Reaches"
          value="48,392"
          icon={Users}
          change="+12.5%"
          changeType="positive"
        />
        <StatCard
          title="Avg. Open Rate"
          value="23.4%"
          icon={TrendingUp}
          change="+1.2%"
          changeType="positive"
        />
        <StatCard
          title="Conversion Rate"
          value="2.8%"
          icon={BarChart3}
          change="+0.5%"
          changeType="positive"
        />
      </div>

      {/* Performance Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartArea 
          data={mockChartData} 
          title="Campaign Performance Trend" 
        />
        
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Top Performing Campaigns</h3>
          <div className="space-y-4">
            {mockCampaigns.slice(0, 3).map((campaign, index) => (
              <div key={campaign.id} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                <div>
                  <div className="font-medium text-white text-sm">{campaign.name}</div>
                  <div className="text-xs text-gray-400">
                    {((campaign.opened / campaign.sent) * 100).toFixed(1)}% open rate
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-emerald-400">
                    {campaign.replies} replies
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detailed Metrics Table */}
      <Table headers={headers} data={analyticsData} />

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real analytics data */}
          Analytics are using mock data. Connect to backend for real performance tracking.
        </p>
      </div>
    </div>
  );
}