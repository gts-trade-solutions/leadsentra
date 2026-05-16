'use client';

import SectionHeader from '@/components/SectionHeader';
import FormField from '@/components/FormField';
import { useState } from 'react';

export default function SettingsPage() {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [notifications, setNotifications] = useState({
    emailCampaigns: true,
    newLeads: true,
    weeklyReports: false,
    systemUpdates: true
  });

  const toggleNotification = (key) => {
    setNotifications(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Settings"
        description="Manage your account preferences and configurations"
      />

      {/* Account Settings */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Account Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Company Name"
            placeholder="Your Company"
          />
          <FormField
            label="Website"
            placeholder="https://yourcompany.com"
          />
          <FormField
            label="Industry"
            type="select"
            options={[
              { value: 'technology', label: 'Technology' },
              { value: 'healthcare', label: 'Healthcare' },
              { value: 'finance', label: 'Finance' },
            ]}
          />
          <FormField
            label="Company Size"
            type="select"
            options={[
              { value: '1-10', label: '1-10 employees' },
              { value: '11-50', label: '11-50 employees' },
              { value: '51-200', label: '51-200 employees' },
            ]}
          />
        </div>
      </div>

      {/* Email Settings */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Email Settings</h3>
        <div className="space-y-4">
          <FormField
            label="From Name"
            placeholder="Your Name"
          />
          <FormField
            label="From Email"
            type="email"
            placeholder="you@yourcompany.com"
          />
          <FormField
            label="Reply-To Email"
            type="email"
            placeholder="replies@yourcompany.com"
          />
          <FormField
            label="Email Signature"
            type="textarea"
            rows={4}
            placeholder="Enter your email signature..."
          />
        </div>
      </div>

      {/* Security Settings */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Security</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
            <div>
              <div className="font-medium text-white text-sm">Two-Factor Authentication</div>
              <div className="text-xs text-gray-400">Add an extra layer of security</div>
            </div>
            <button
              onClick={() => {
                setTwoFactorEnabled(!twoFactorEnabled);
                alert(twoFactorEnabled ? '2FA disabled' : '2FA enabled');
              }}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                twoFactorEnabled 
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700' 
                  : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              }`}
            >
              {twoFactorEnabled ? 'Enabled' : 'Enable'}
            </button>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
            <div>
              <div className="font-medium text-white text-sm">API Access</div>
              <div className="text-xs text-gray-400">Manage API keys and access</div>
            </div>
            <button
              onClick={() => alert('API management functionality')}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs rounded transition-colors"
            >
              Manage
            </button>
          </div>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Notifications</h3>
        <div className="space-y-4">
          {[
            { key: 'emailCampaigns', label: 'Email campaign results' },
            { key: 'newLeads', label: 'New lead notifications' },
            { key: 'weeklyReports', label: 'Weekly performance reports' },
            { key: 'systemUpdates', label: 'System updates and maintenance' }
          ].map((setting) => (
            <div key={setting.key} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
              <span className="text-sm text-gray-300">{setting.label}</span>
              <button
                onClick={() => toggleNotification(setting.key)}
                className={`w-12 h-6 rounded-full relative transition-colors ${
                  notifications[setting.key] ? 'bg-emerald-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                  notifications[setting.key] ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => alert('Settings saved successfully!')}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
        >
          Save Settings
        </button>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real settings management */}
          Settings are disabled in demo. Connect to backend for full configuration options.
        </p>
      </div>
    </div>
  );
}