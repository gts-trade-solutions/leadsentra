import SectionHeader from '@/components/SectionHeader';
import StatCard from '@/components/StatCard';
import ChartArea from '@/components/ChartArea';
import { TrendingUp, Server, Database, Zap } from 'lucide-react';

export default function ScalabilityPage() {
  const scalingData = [
    { name: 'Jan', requests: 1200000, users: 8500 },
    { name: 'Feb', requests: 1450000, users: 9200 },
    { name: 'Mar', requests: 1680000, users: 10100 },
    { name: 'Apr', requests: 1920000, users: 11500 },
    { name: 'May', requests: 2150000, users: 12800 },
    { name: 'Jun', requests: 2400000, users: 14200 },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Scalability & Performance"
        description="Monitor system capacity and scaling metrics"
      />

      {/* Scaling Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Current Load"
          value="23%"
          icon={Server}
          change="-5%"
          changeType="positive"
        />
        <StatCard
          title="Auto-scaling Events"
          value="12"
          icon={TrendingUp}
          badge="This Month"
        />
        <StatCard
          title="Database Performance"
          value="98.7%"
          icon={Database}
          badge="Optimal"
        />
        <StatCard
          title="Response Time"
          value="145ms"
          icon={Zap}
          change="-12ms"
          changeType="positive"
        />
      </div>

      {/* Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartArea 
          data={scalingData} 
          title="Growth Trends" 
        />
        
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Scaling Configuration</h3>
          <div className="space-y-4">
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">Auto-scaling</span>
                <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                  Enabled
                </span>
              </div>
              <div className="text-xs text-gray-400">Automatically scale based on demand</div>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">Load Balancing</span>
                <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                  Active
                </span>
              </div>
              <div className="text-xs text-gray-400">Distribute traffic across 8 servers</div>
            </div>

            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">CDN</span>
                <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                  Optimized
                </span>
              </div>
              <div className="text-xs text-gray-400">Global content delivery network</div>
            </div>
          </div>
        </div>
      </div>

      {/* Resource Usage */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Resource Usage</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">CPU Usage</span>
              <span className="text-sm font-medium text-white">23%</span>
            </div>
            <div className="w-full bg-gray-600 rounded-full h-2">
              <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '23%' }}></div>
            </div>
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">Memory Usage</span>
              <span className="text-sm font-medium text-white">67%</span>
            </div>
            <div className="w-full bg-gray-600 rounded-full h-2">
              <div className="bg-yellow-500 h-2 rounded-full" style={{ width: '67%' }}></div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">Storage Usage</span>
              <span className="text-sm font-medium text-white">45%</span>
            </div>
            <div className="w-full bg-gray-600 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full" style={{ width: '45%' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Scaling Recommendations */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Scaling Recommendations</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-blue-600/10 border border-blue-600/30 rounded-lg">
            <TrendingUp className="w-4 h-4 text-blue-400 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-white">Database Optimization</div>
              <div className="text-xs text-gray-400">Consider adding read replicas for better performance</div>
            </div>
          </div>
          
          <div className="flex items-start gap-3 p-3 bg-green-600/10 border border-green-600/30 rounded-lg">
            <Server className="w-4 h-4 text-green-400 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-white">Caching Strategy</div>
              <div className="text-xs text-gray-400">Implement Redis caching for frequently accessed data</div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real scalability monitoring and auto-scaling */}
          Scalability metrics are using mock data. Connect to backend for real performance monitoring.
        </p>
      </div>
    </div>
  );
}