'use client';

import SectionHeader from '@/components/SectionHeader';
import StatCard from '@/components/StatCard';
import ChartArea from '@/components/ChartArea';
import { Target, TrendingUp, Users, Eye } from 'lucide-react';

export default function MarketingPage() {
  const campaignData = [
    { name: 'Week 1', impressions: 12500, clicks: 890 },
    { name: 'Week 2', impressions: 15200, clicks: 1240 },
    { name: 'Week 3', impressions: 18900, clicks: 1560 },
    { name: 'Week 4', impressions: 14300, clicks: 1120 },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Marketing Campaigns"
        description="Manage and track your marketing initiatives"
      />

      {/* Marketing Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Campaigns"
          value="8"
          icon={Target}
        />
        <StatCard
          title="Total Impressions"
          value="2.4M"
          icon={Eye}
          change="+15%"
          changeType="positive"
        />
        <StatCard
          title="Click-through Rate"
          value="3.2%"
          icon={TrendingUp}
          change="+0.8%"
          changeType="positive"
        />
        <StatCard
          title="Leads Generated"
          value="1,247"
          icon={Users}
          change="+23%"
          changeType="positive"
        />
      </div>

      {/* Campaign Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartArea 
          data={campaignData} 
          title="Campaign Performance" 
        />
        
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Top Performing Campaigns</h3>
          <div className="space-y-4">
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-white text-sm">Product Launch 2024</div>
                <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                  Active
                </span>
              </div>
              <div className="text-xs text-gray-400">CTR: 4.2% • Conversions: 156</div>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-white text-sm">Holiday Promotion</div>
                <span className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">
                  Completed
                </span>
              </div>
              <div className="text-xs text-gray-400">CTR: 3.8% • Conversions: 234</div>
            </div>

            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-white text-sm">Brand Awareness</div>
                <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                  Active
                </span>
              </div>
              <div className="text-xs text-gray-400">CTR: 2.9% • Conversions: 89</div>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign Management */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Campaign Management</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => alert('Create marketing campaign functionality')}
            className="p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
          >
            <Target className="w-6 h-6 text-emerald-400 mb-2" />
            <div className="font-medium text-white text-sm mb-1">Create Campaign</div>
            <div className="text-xs text-gray-400">Launch new marketing campaign</div>
          </button>
          
          <button
            onClick={() => alert('Marketing analytics functionality')}
            className="p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
          >
            <TrendingUp className="w-6 h-6 text-blue-400 mb-2" />
            <div className="font-medium text-white text-sm mb-1">Analytics</div>
            <div className="text-xs text-gray-400">View detailed performance metrics</div>
          </button>
          
          <button
            onClick={() => alert('Audience management functionality')}
            className="p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
          >
            <Users className="w-6 h-6 text-purple-400 mb-2" />
            <div className="font-medium text-white text-sm mb-1">Audience</div>
            <div className="text-xs text-gray-400">Manage target audiences</div>
          </button>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for marketing campaign management */}
          Marketing campaign management is UI-only. Connect to backend for real campaign tracking.
        </p>
      </div>
    </div>
  );
}