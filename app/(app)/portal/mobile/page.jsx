'use client';

import SectionHeader from '@/components/SectionHeader';
import { Smartphone, Download, QrCode, Apple, Play } from 'lucide-react';

export default function MobilePage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Mobile Applications"
        description="Access LeadSentra on the go with our mobile apps"
      />

      {/* Mobile App Overview */}
      <div className="section-card">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-semibold text-white mb-4">LeadSentra Mobile</h3>
            <p className="text-gray-300 mb-6">
              Take your sales intelligence with you. Access contacts, manage campaigns,
              and track performance from anywhere with our native mobile applications.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                <span className="text-sm text-gray-300">Access your complete contact database</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                <span className="text-sm text-gray-300">Manage email campaigns on the go</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                <span className="text-sm text-gray-300">Real-time notifications and alerts</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                <span className="text-sm text-gray-300">Offline access to key data</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-48 h-48 bg-gray-700 rounded-2xl flex items-center justify-center">
              <QrCode className="w-24 h-24 text-gray-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Download Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="section-card">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-gray-700 rounded-xl flex items-center justify-center">
              <Apple className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white">iOS App</h3>
              <p className="text-sm text-gray-400">Available on the App Store</p>
            </div>
          </div>

          <button
            onClick={() => alert('iOS app download would start here')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download for iOS
          </button>

          <div className="mt-4 text-xs text-gray-500">
            Requires iOS 14.0 or later
          </div>
        </div>

        <div className="section-card">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-gray-700 rounded-xl flex items-center justify-center">
              <Play className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Android App</h3>
              <p className="text-sm text-gray-400">Available on Google Play</p>
            </div>
          </div>

          <button
            onClick={() => alert('Android app download would start here')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download for Android
          </button>

          <div className="mt-4 text-xs text-gray-500">
            Requires Android 8.0 or later
          </div>
        </div>
      </div>

      {/* Mobile Features */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Mobile Features</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-700 rounded-lg text-center">
            <Smartphone className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <div className="font-medium text-white text-sm mb-1">Native Performance</div>
            <div className="text-xs text-gray-400">Optimized for mobile devices</div>
          </div>

          <div className="p-4 bg-gray-700 rounded-lg text-center">
            <Download className="w-8 h-8 text-blue-400 mx-auto mb-2" />
            <div className="font-medium text-white text-sm mb-1">Offline Sync</div>
            <div className="text-xs text-gray-400">Work without internet connection</div>
          </div>

          <div className="p-4 bg-gray-700 rounded-lg text-center">
            <QrCode className="w-8 h-8 text-purple-400 mx-auto mb-2" />
            <div className="font-medium text-white text-sm mb-1">QR Scanner</div>
            <div className="text-xs text-gray-400">Quickly add contacts from business cards</div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for mobile app distribution and updates */}
          Mobile app downloads are disabled in demo. Connect to app stores for real distribution.
        </p>
      </div>
    </div>
  );
}