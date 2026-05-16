'use client';

import SectionHeader from '@/components/SectionHeader';
import { Plus, Bot, Zap, Settings } from 'lucide-react';

export default function CrmAutomationPage() {
  const automationRules = [
    {
      id: 1,
      name: 'Lead Scoring Update',
      trigger: 'Email Opened',
      action: 'Increase Lead Score by 10',
      status: 'Active'
    },
    {
      id: 2,
      name: 'Hot Lead Assignment',
      trigger: 'Lead Score > 80',
      action: 'Assign to Senior Sales Rep',
      status: 'Active'
    },
    {
      id: 3,
      name: 'Follow-up Reminder',
      trigger: 'No Activity for 7 days',
      action: 'Create Task for Sales Rep',
      status: 'Paused'
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="CRM Automation"
        description="Automate your sales processes with intelligent workflows"
      >
        <button 
          onClick={() => alert('Add automation rule functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </SectionHeader>

      {/* Automation Rules */}
      <div className="space-y-4">
        {automationRules.map((rule) => (
          <div key={rule.id} className="section-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-600/20 rounded-lg flex items-center justify-center">
                  <Bot className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{rule.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded">
                      IF: {rule.trigger}
                    </span>
                    <Zap className="w-3 h-3 text-gray-400" />
                    <span className="px-2 py-1 bg-purple-600/20 text-purple-400 text-xs rounded">
                      THEN: {rule.action}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  rule.status === 'Active' 
                    ? 'bg-emerald-600/20 text-emerald-400' 
                    : 'bg-yellow-600/20 text-yellow-400'
                }`}>
                  {rule.status}
                </span>
                <button
                  onClick={() => alert(`Configure ${rule.name} automation rule`)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for CRM automation rules */}
          CRM automation rules are UI-only. Connect to backend for workflow automation.
        </p>
      </div>
    </div>
  );
}