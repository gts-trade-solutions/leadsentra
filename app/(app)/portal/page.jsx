'use client';

import StatCard from '@/components/StatCard';
import ChartArea from '@/components/ChartArea';
import ActivityItem from '@/components/ActivityItem';
import { mockStats, mockChartData, mockActivities } from '@/lib/mock';
import { formatNumber, formatCurrency } from '@/lib/utils';
import { Users, Building2, Mail, TrendingUp, MousePointer, DollarSign } from 'lucide-react';

export default function Dashboard() {
  const emailPerformance = [
    { label: 'Sent', value: 48392, color: 'bg-blue-500' },
    { label: 'Opened', value: 11324, color: 'bg-emerald-500' },
    { label: 'Clicked', value: 2275, color: 'bg-purple-500' },
    { label: 'Bounced', value: 483, color: 'bg-red-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Welcome back, John!</h1>
        <p className="text-gray-400">Here&apos;s what&apos;s happening with your sales today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title="Total Contacts"
          value={formatNumber(mockStats.totalContacts)}
          icon={Users}
          change="12.5%"
          changeType="positive"
        />
        <StatCard
          title="Active Companies"
          value={formatNumber(mockStats.activeCompanies)}
          icon={Building2}
          change="8.3%"
          changeType="positive"
        />
        <StatCard
          title="Active Campaigns"
          value={mockStats.activeCampaigns}
          icon={Mail}
          badge="Live"
        />
        <StatCard
          title="Emails Sent"
          value={formatNumber(mockStats.emailsSent)}
          icon={Mail}
          change="23.1%"
          changeType="positive"
        />
        <StatCard
          title="Open Rate"
          value={`${mockStats.openRate}%`}
          icon={TrendingUp}
          change="+1.2%"
          changeType="positive"
        />
        <StatCard
          title="Revenue"
          value={formatCurrency(mockStats.revenue)}
          icon={DollarSign}
          change="34.2%"
          changeType="positive"
        />
      </div>

      {/* Charts and Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartArea 
          data={mockChartData} 
          title="Weekly Performance" 
        />
        
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Email Performance</h3>
          <div className="space-y-4">
            {emailPerformance.map((item, index) => (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${item.color}`} />
                  <span className="text-sm text-gray-300">{item.label}</span>
                </div>
                <span className="text-sm font-medium text-white">
                  {formatNumber(item.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
        <div className="space-y-1">
          {mockActivities.slice(0, 5).map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-gray-700">
          <button className="text-emerald-400 hover:text-emerald-300 text-sm font-medium">
            View all activity →
          </button>
        </div>
      </div>
    </div>
  );
}