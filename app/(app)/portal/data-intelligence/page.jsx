'use client';

import SectionHeader from '@/components/SectionHeader';
import ChartArea from '@/components/ChartArea';
import StatCard from '@/components/StatCard';
import { BarChart3, Database, Filter, TrendingUp } from 'lucide-react';

export default function DataIntelligencePage() {
  const industryData = [
    { name: 'Technology', contacts: 450, companies: 89 },
    { name: 'Healthcare', contacts: 320, companies: 67 },
    { name: 'Finance', contacts: 280, companies: 45 },
    { name: 'Manufacturing', contacts: 190, companies: 34 },
    { name: 'Retail', contacts: 150, companies: 28 },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Data Intelligence"
        description="Analyze your data and discover market insights"
      >
        <button 
          onClick={() => alert('Data intelligence filters functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
      </SectionHeader>

      {/* Data Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Records"
          value="2.8M"
          icon={Database}
        />
        <StatCard
          title="Data Quality"
          value="94.2%"
          icon={TrendingUp}
          change="+1.3%"
          changeType="positive"
        />
        <StatCard
          title="Industries Covered"
          value="47"
          icon={BarChart3}
        />
        <StatCard
          title="Countries"
          value="156"
          icon={BarChart3}
        />
      </div>

      {/* Charts and Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartArea 
          data={industryData} 
          title="Industry Distribution" 
        />
        
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Market Insights</h3>
          <div className="space-y-4">
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="font-medium text-white text-sm mb-1">Technology Sector Growth</div>
              <div className="text-xs text-gray-400">23% increase in new contacts this quarter</div>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="font-medium text-white text-sm mb-1">Healthcare Expansion</div>
              <div className="text-xs text-gray-400">New opportunities in telemedicine companies</div>
            </div>

            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="font-medium text-white text-sm mb-1">Geographic Trends</div>
              <div className="text-xs text-gray-400">West Coast showing highest engagement rates</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Data Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select 
            onChange={(e) => console.log('Industry filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Industries</option>
            <option>Technology</option>
            <option>Healthcare</option>
            <option>Finance</option>
            <option>Manufacturing</option>
          </select>
          <select 
            onChange={(e) => console.log('Company size filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Company Sizes</option>
            <option>Startup (1-50)</option>
            <option>SMB (51-200)</option>
            <option>Enterprise (200+)</option>
          </select>
          <select 
            onChange={(e) => console.log('Location filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Locations</option>
            <option>North America</option>
            <option>Europe</option>
            <option>Asia Pacific</option>
          </select>
          <select 
            onChange={(e) => console.log('Time range filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Time Ranges</option>
            <option>Last 30 Days</option>
            <option>Last 90 Days</option>
            <option>Last Year</option>
          </select>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real data intelligence and filtering */}
          Data intelligence is using mock data. Connect to backend for real market analysis.
        </p>
      </div>
    </div>
  );
}