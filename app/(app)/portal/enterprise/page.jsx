import SectionHeader from '@/components/SectionHeader';
import StatCard from '@/components/StatCard';
import { Shield, Users, Globe, Zap, Building2, Lock } from 'lucide-react';

export default function EnterprisePage() {
  const enterpriseFeatures = [
    {
      icon: Shield,
      title: 'Advanced Security',
      description: 'SOC2 compliance, SSO integration, and advanced encryption',
      status: 'Active'
    },
    {
      icon: Users,
      title: 'Team Management',
      description: 'Unlimited users with role-based access control',
      status: 'Active'
    },
    {
      icon: Globe,
      title: 'Global Infrastructure',
      description: 'Multi-region deployment with 99.99% uptime SLA',
      status: 'Active'
    },
    {
      icon: Zap,
      title: 'API Rate Limits',
      description: 'Higher API limits and priority processing',
      status: 'Active'
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Enterprise Features"
        description="Advanced capabilities for large organizations"
      />

      {/* Enterprise Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Team Members"
          value="247"
          icon={Users}
          badge="Unlimited"
        />
        <StatCard
          title="API Calls/Month"
          value="2.4M"
          icon={Zap}
          badge="10M Limit"
        />
        <StatCard
          title="Data Centers"
          value="12"
          icon={Globe}
          badge="Global"
        />
        <StatCard
          title="Uptime"
          value="99.99%"
          icon={Shield}
          badge="SLA"
        />
      </div>

      {/* Enterprise Features Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {enterpriseFeatures.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className="section-card">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-emerald-600/20 rounded-lg flex items-center justify-center">
                  <Icon className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-white">{feature.title}</h3>
                    <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">
                      {feature.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">{feature.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Security & Compliance */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-emerald-400" />
          Security & Compliance
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-700 rounded-lg text-center">
            <Shield className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <div className="font-medium text-white text-sm mb-1">SOC2 Type II</div>
            <div className="text-xs text-gray-400">Certified</div>
          </div>
          
          <div className="p-4 bg-gray-700 rounded-lg text-center">
            <Globe className="w-8 h-8 text-blue-400 mx-auto mb-2" />
            <div className="font-medium text-white text-sm mb-1">GDPR</div>
            <div className="text-xs text-gray-400">Compliant</div>
          </div>
          
          <div className="p-4 bg-gray-700 rounded-lg text-center">
            <Building2 className="w-8 h-8 text-purple-400 mx-auto mb-2" />
            <div className="font-medium text-white text-sm mb-1">CCPA</div>
            <div className="text-xs text-gray-400">Compliant</div>
          </div>
        </div>
      </div>

      {/* Support & SLA */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Enterprise Support</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-white mb-3">Support Tiers</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                <span className="text-sm text-gray-300">Dedicated Account Manager</span>
                <span className="text-xs text-emerald-400">✓ Included</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                <span className="text-sm text-gray-300">24/7 Priority Support</span>
                <span className="text-xs text-emerald-400">✓ Included</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                <span className="text-sm text-gray-300">Custom Integrations</span>
                <span className="text-xs text-emerald-400">✓ Available</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-white mb-3">Service Level Agreement</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                <span className="text-sm text-gray-300">Uptime Guarantee</span>
                <span className="text-xs text-white">99.99%</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                <span className="text-sm text-gray-300">Response Time</span>
                <span className="text-xs text-white">&lt; 1 hour</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                <span className="text-sm text-gray-300">Resolution Time</span>
                <span className="text-xs text-white">&lt; 4 hours</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for enterprise feature management */}
          Enterprise features are UI-only. Connect to backend for real enterprise functionality.
        </p>
      </div>
    </div>
  )
}