'use client';

import SectionHeader from '@/components/SectionHeader';
import ActivityItem from '@/components/ActivityItem';
import { Filter, Calendar } from 'lucide-react';

export default function ActivityPage() {
  const activities = [
    {
      id: 1,
      type: 'email',
      description: 'Campaign "Q1 Enterprise Outreach" sent to 2,840 contacts',
      time: '2 minutes ago',
      user: 'System'
    },
    {
      id: 2,
      type: 'contact',
      description: 'New contact added: Sarah Johnson (Global Dynamics)',
      time: '15 minutes ago',
      user: 'John Doe'
    },
    {
      id: 3,
      type: 'deal',
      description: 'Deal "Enterprise Corp" moved to Proposal stage',
      time: '1 hour ago',
      user: 'Jane Smith'
    },
    {
      id: 4,
      type: 'import',
      description: 'Successfully imported 1,247 contacts from CSV',
      time: '2 hours ago',
      user: 'System'
    },
    {
      id: 5,
      type: 'meeting',
      description: 'Meeting scheduled with TechStart Inc for product demo',
      time: '3 hours ago',
      user: 'Mike Wilson'
    },
    {
      id: 6,
      type: 'email',
      description: 'Email opened by 156 recipients in "Product Launch" campaign',
      time: '4 hours ago',
      user: 'System'
    },
    {
      id: 7,
      type: 'contact',
      description: 'Contact "Alex Rivera" updated with new phone number',
      time: '5 hours ago',
      user: 'Sarah Johnson'
    },
    {
      id: 8,
      type: 'deal',
      description: 'New deal created: "FinTech Solutions" worth $95,000',
      time: '6 hours ago',
      user: 'John Doe'
    },
    {
      id: 9,
      type: 'import',
      description: 'Data sync completed with Salesforce CRM',
      time: '8 hours ago',
      user: 'System'
    },
    {
      id: 10,
      type: 'email',
      description: 'Campaign "Holiday Follow-up" paused by user request',
      time: '1 day ago',
      user: 'Jane Smith'
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Real-Time Activity"
        description="Monitor all system activities and user actions in real-time"
      >
        <button 
          onClick={() => alert('Date range picker functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Calendar className="w-4 h-4" />
          Date Range
        </button>
        <button 
          onClick={() => alert('Activity filters functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
      </SectionHeader>

      {/* Activity Filters */}
      <div className="section-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select 
            onChange={(e) => console.log('Activity type filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Activity Types</option>
            <option>Email</option>
            <option>Contact</option>
            <option>Deal</option>
            <option>Import</option>
          </select>
          <select 
            onChange={(e) => console.log('User filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Users</option>
            <option>John Doe</option>
            <option>Jane Smith</option>
            <option>System</option>
          </select>
          <input
            type="date"
            onChange={(e) => console.log('Date filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          />
          <input
            type="text"
            placeholder="Search activities..."
            onChange={(e) => console.log('Activity search:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          />
        </div>
      </div>

      {/* Activity Feed */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Activity Feed</h3>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
        
        <div className="mt-6 pt-4 border-t border-gray-700 text-center">
          <button
            onClick={() => alert('Loading more activities...')}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Load More Activities
          </button>
        </div>
      </div>

      {/* Activity Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="section-card text-center">
          <div className="text-2xl font-bold text-white">247</div>
          <div className="text-sm text-gray-400">Activities Today</div>
        </div>
        
        <div className="section-card text-center">
          <div className="text-2xl font-bold text-white">12</div>
          <div className="text-sm text-gray-400">Active Users</div>
        </div>
        
        <div className="section-card text-center">
          <div className="text-2xl font-bold text-white">89</div>
          <div className="text-sm text-gray-400">System Events</div>
        </div>
        
        <div className="section-card text-center">
          <div className="text-2xl font-bold text-white">156</div>
          <div className="text-sm text-gray-400">User Actions</div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real-time activity monitoring */}
          Activity feed is using mock data. Connect to backend for real-time activity tracking.
        </p>
      </div>
    </div>
  );
}