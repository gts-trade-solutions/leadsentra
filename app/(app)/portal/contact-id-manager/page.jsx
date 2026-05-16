'use client';

import SectionHeader from '@/components/SectionHeader';
import { Users, AlertTriangle } from 'lucide-react';

export default function ContactIdManagerPage() {
  const duplicates = [
    {
      id: 1,
      contacts: [
        { name: 'John Smith', email: 'john@acme.com', company: 'Acme Corp' },
        { name: 'J. Smith', email: 'j.smith@acme.com', company: 'Acme Corp' },
      ],
      confidence: 95
    },
    {
      id: 2,
      contacts: [
        { name: 'Sarah Johnson', email: 'sarah@tech.com', company: 'TechCorp' },
        { name: 'Sarah J.', email: 'sarah.johnson@techcorp.com', company: 'TechCorp' },
      ],
      confidence: 87
    }
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Contact ID Manager"
        description="Identify and manage duplicate contacts to maintain data quality"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {duplicates.map((duplicate) => (
          <div key={duplicate.id} className="section-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                <span className="font-semibold text-white">Potential Duplicate</span>
              </div>
              <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 text-xs font-medium rounded-full">
                {duplicate.confidence}% match
              </span>
            </div>

            <div className="space-y-4">
              {duplicate.contacts.map((contact, index) => (
                <div key={index} className="p-3 bg-gray-700 rounded-lg">
                  <div className="font-medium text-white mb-1">{contact.name}</div>
                  <div className="text-sm text-gray-400">{contact.email}</div>
                  <div className="text-sm text-gray-400">{contact.company}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-700">
              <button
                onClick={() => alert(`Merging duplicate contacts with ${duplicate.confidence}% confidence`)}
                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Merge Contacts
              </button>
              <button
                onClick={() => alert('Keeping contacts separate')}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Keep Separate
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for real duplicate detection and merging */}
          Duplicate detection is using mock data. Connect to backend for AI-powered contact matching.
        </p>
      </div>
    </div>
  );
}