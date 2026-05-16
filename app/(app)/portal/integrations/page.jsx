'use client';

import SectionHeader from '@/components/SectionHeader';
import { mockIntegrations } from '@/lib/mock';
import { Check, Plus, ExternalLink } from 'lucide-react';

export default function IntegrationsPage() {
  const getStatusColor = (status) => {
    return status === 'connected'
      ? 'text-emerald-400 bg-emerald-400/20'
      : 'text-gray-400 bg-gray-400/20';
  };

  const getStatusText = (status) => {
    return status === 'connected' ? 'Connected' : 'Available';
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description="Connect LeadSentra with your favorite tools and platforms"
      />

      {/* Integration Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {mockIntegrations.map((integration, index) => (
          <div key={index} className="section-card">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center">
                  {/* Placeholder for integration logos */}
                  <div className="w-6 h-6 bg-gray-600 rounded" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{integration.name}</h3>
                  <p className="text-sm text-gray-400">{integration.description}</p>
                </div>
              </div>

              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(integration.status)}`}>
                {integration.status === 'connected' && <Check className="w-3 h-3 inline mr-1" />}
                {getStatusText(integration.status)}
              </span>
            </div>

            <div className="flex gap-2">
              {integration.status === 'connected' ? (
                <>
                  <button
                    onClick={() => alert(`Configure ${integration.name} integration`)}
                    className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Configure
                  </button>
                  <button
                    onClick={() => alert(`Disconnect ${integration.name} integration`)}
                    className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={() => alert(`Connect ${integration.name} integration`)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Connect
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Popular Integrations */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Popular Integrations</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-3 bg-gray-700 rounded-lg">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
              <ExternalLink className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-medium text-white text-sm">Salesforce CRM</div>
              <div className="text-xs text-gray-400">Sync leads and opportunities</div>
            </div>
            <button
              onClick={() => alert('Connect Salesforce CRM')}
              className="ml-auto px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded transition-colors"
            >
              Connect
            </button>
          </div>

          <div className="flex items-center gap-3 p-3 bg-gray-700 rounded-lg">
            <div className="w-8 h-8 bg-orange-600 rounded flex items-center justify-center">
              <ExternalLink className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-medium text-white text-sm">HubSpot</div>
              <div className="text-xs text-gray-400">Marketing automation</div>
            </div>
            <button
              onClick={() => alert('Connect HubSpot')}
              className="ml-auto px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded transition-colors"
            >
              Connect
            </button>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real integration management */}
          Integration connections are disabled in demo. Connect to backend for full functionality.
        </p>
      </div>
    </div>
  );
}