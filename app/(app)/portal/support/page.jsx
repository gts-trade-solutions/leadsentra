'use client';

import SectionHeader from '@/components/SectionHeader';
import Table from '@/components/Table';
import { MessageSquare, Clock, User, AlertCircle } from 'lucide-react';

export default function SupportPage() {
  const headers = ['Ticket ID', 'Subject', 'Priority', 'Status', 'Assignee', 'Created'];
  
  const supportData = [
    {
      ticketId: '#SUP-2024-001',
      subject: 'Email integration not working',
      priority: (
        <span className="px-2 py-1 bg-red-600/20 text-red-400 rounded-full text-xs font-medium">
          High
        </span>
      ),
      status: (
        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded-full text-xs font-medium">
          In Progress
        </span>
      ),
      assignee: 'Sarah Johnson',
      created: '2024-01-15',
    },
    {
      ticketId: '#SUP-2024-002',
      subject: 'Question about billing cycle',
      priority: (
        <span className="px-2 py-1 bg-blue-600/20 text-blue-400 rounded-full text-xs font-medium">
          Medium
        </span>
      ),
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Resolved
        </span>
      ),
      assignee: 'Mike Wilson',
      created: '2024-01-14',
    },
    {
      ticketId: '#SUP-2024-003',
      subject: 'Feature request: Custom fields',
      priority: (
        <span className="px-2 py-1 bg-green-600/20 text-green-400 rounded-full text-xs font-medium">
          Low
        </span>
      ),
      status: (
        <span className="px-2 py-1 bg-gray-600/20 text-gray-400 rounded-full text-xs font-medium">
          Open
        </span>
      ),
      assignee: 'John Doe',
      created: '2024-01-13',
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Support Sessions"
        description="Manage customer support tickets and sessions"
      />

      {/* Support Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="section-card text-center">
          <MessageSquare className="w-8 h-8 text-blue-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">24</div>
          <div className="text-sm text-gray-400">Open Tickets</div>
        </div>
        
        <div className="section-card text-center">
          <Clock className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">2.3h</div>
          <div className="text-sm text-gray-400">Avg Response Time</div>
        </div>
        
        <div className="section-card text-center">
          <User className="w-8 h-8 text-green-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">156</div>
          <div className="text-sm text-gray-400">Resolved This Week</div>
        </div>
        
        <div className="section-card text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">3</div>
          <div className="text-sm text-gray-400">High Priority</div>
        </div>
      </div>

      {/* Support Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Tickets</h3>
          <Table headers={headers} data={supportData} actions />
        </div>
        
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Live Chat Preview</h3>
          <div className="space-y-3">
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white">U</span>
                </div>
                <span className="text-sm font-medium text-white">User</span>
                <span className="text-xs text-gray-400">2:34 PM</span>
              </div>
              <p className="text-sm text-gray-300">Hi, I&apos;m having trouble with email sync</p>
            </div>
            
            <div className="p-3 bg-emerald-600/10 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 bg-emerald-600 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white">S</span>
                </div>
                <span className="text-sm font-medium text-white">Support</span>
                <span className="text-xs text-gray-400">2:35 PM</span>
              </div>
              <p className="text-sm text-gray-300">I&apos;d be happy to help! Can you tell me which email provider you&apos;re using?</p>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-xs text-white">U</span>
                </div>
                <span className="text-sm font-medium text-white">User</span>
                <span className="text-xs text-gray-400">2:36 PM</span>
              </div>
              <p className="text-sm text-gray-300">I&apos;m using Gmail for Business</p>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Type a message..."
                onChange={(e) => console.log('Chat message:', e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
              />
              <button
                onClick={() => alert('Message sent!')}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for support ticket management and live chat */}
          Support system is UI-only. Connect to backend for real ticket management and live chat.
        </p>
      </div>
    </div>
  );
}