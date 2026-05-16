'use client'
import SectionHeader from '@/components/SectionHeader';
import StatCard from '@/components/StatCard';
import { Server, Database, Users, Activity, Settings, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export default function PlatformAdminPage() {
  const [systemSettings, setSystemSettings] = useState({
    maintenanceMode: false,
    debugLogging: true,
    rateLimiting: true
  });

  const toggleSetting = (key) => {
    setSystemSettings(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const systemMetrics = [
    { label: 'API Requests', value: '2.4M', change: '+12%' },
    { label: 'Database Queries', value: '847K', change: '+8%' },
    { label: 'Active Sessions', value: '1,247', change: '+5%' },
    { label: 'Error Rate', value: '0.02%', change: '-15%' },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Platform Administration"
        description="Monitor system health and manage platform-wide settings"
      />

      {/* System Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="System Status"
          value="Healthy"
          icon={Server}
          badge="99.9%"
        />
        <StatCard
          title="Database Health"
          value="Optimal"
          icon={Database}
          badge="Active"
        />
        <StatCard
          title="Active Users"
          value="12,847"
          icon={Users}
          change="+234"
          changeType="positive"
        />
        <StatCard
          title="System Load"
          value="23%"
          icon={Activity}
          change="-5%"
          changeType="positive"
        />
      </div>

      {/* System Metrics */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">System Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {systemMetrics.map((metric, index) => (
            <div key={index} className="p-4 bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-400 mb-1">{metric.label}</div>
              <div className="text-xl font-bold text-white">{metric.value}</div>
              <div className="text-xs text-emerald-400">{metric.change}</div>
            </div>
          ))}
        </div>
      </div>

      {/* System Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">System Controls</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
              <div>
                <div className="font-medium text-white text-sm">Maintenance Mode</div>
                <div className="text-xs text-gray-400">Enable for system updates</div>
              </div>
              <button
                onClick={() => toggleSetting('maintenanceMode')}
                className={`w-12 h-6 rounded-full relative transition-colors ${
                  systemSettings.maintenanceMode ? 'bg-emerald-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                  systemSettings.maintenanceMode ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
              <div>
                <div className="font-medium text-white text-sm">Debug Logging</div>
                <div className="text-xs text-gray-400">Enhanced error tracking</div>
              </div>
              <button
                onClick={() => toggleSetting('debugLogging')}
                className={`w-12 h-6 rounded-full relative transition-colors ${
                  systemSettings.debugLogging ? 'bg-emerald-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                  systemSettings.debugLogging ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
              <div>
                <div className="font-medium text-white text-sm">Rate Limiting</div>
                <div className="text-xs text-gray-400">API request throttling</div>
              </div>
              <button
                onClick={() => toggleSetting('rateLimiting')}
                className={`w-12 h-6 rounded-full relative transition-colors ${
                  systemSettings.rateLimiting ? 'bg-emerald-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                  systemSettings.rateLimiting ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </div>
        </div>

        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Alerts</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-yellow-600/10 border border-yellow-600/30 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-white">High Memory Usage</div>
                <div className="text-xs text-gray-400">Database server at 85% memory</div>
                <div className="text-xs text-gray-500 mt-1">2 hours ago</div>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-blue-600/10 border border-blue-600/30 rounded-lg">
              <Settings className="w-4 h-4 text-blue-400 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-white">System Update</div>
                <div className="text-xs text-gray-400">Security patches applied successfully</div>
                <div className="text-xs text-gray-500 mt-1">6 hours ago</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real system monitoring and administration */}
          Platform administration is UI-only. Connect to backend for real system monitoring and controls.
        </p>
      </div>
    </div>
  );
}