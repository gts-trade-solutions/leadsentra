'use client';

import SectionHeader from '@/components/SectionHeader';
import Table from '@/components/Table';
import { Plus, UserPlus, Shield, Users } from 'lucide-react';

export default function UsersRolesPage() {
  const headers = ['Name', 'Email', 'Role', 'Last Active', 'Status'];
  
  const userData = [
    {
      name: 'John Doe',
      email: 'john@company.com',
      role: (
        <span className="px-2 py-1 bg-purple-600/20 text-purple-400 rounded-full text-xs font-medium">
          Admin
        </span>
      ),
      lastActive: '2 hours ago',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Active
        </span>
      ),
    },
    {
      name: 'Jane Smith',
      email: 'jane@company.com',
      role: (
        <span className="px-2 py-1 bg-blue-600/20 text-blue-400 rounded-full text-xs font-medium">
          Sales Manager
        </span>
      ),
      lastActive: '1 day ago',
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Active
        </span>
      ),
    },
    {
      name: 'Mike Wilson',
      email: 'mike@company.com',
      role: (
        <span className="px-2 py-1 bg-green-600/20 text-green-400 rounded-full text-xs font-medium">
          Sales Rep
        </span>
      ),
      lastActive: '3 days ago',
      status: (
        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded-full text-xs font-medium">
          Inactive
        </span>
      ),
    },
  ];

  const roles = [
    {
      name: 'Admin',
      description: 'Full access to all features and settings',
      permissions: ['Manage Users', 'Billing', 'Settings', 'All Data Access'],
      color: 'purple'
    },
    {
      name: 'Sales Manager',
      description: 'Manage sales team and view all sales data',
      permissions: ['Team Management', 'All Contacts', 'Reports', 'Campaigns'],
      color: 'blue'
    },
    {
      name: 'Sales Rep',
      description: 'Access to assigned contacts and basic features',
      permissions: ['Assigned Contacts', 'Email Campaigns', 'Basic Reports'],
      color: 'green'
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Users & Roles"
        description="Manage team members and their permissions"
      >
        <button 
          onClick={() => alert('Invite user functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Invite User
        </button>
      </SectionHeader>

      {/* Team Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="section-card text-center">
          <Users className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">12</div>
          <div className="text-sm text-gray-400">Total Users</div>
        </div>
        <div className="section-card text-center">
          <Shield className="w-8 h-8 text-blue-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">3</div>
          <div className="text-sm text-gray-400">Roles</div>
        </div>
        <div className="section-card text-center">
          <UserPlus className="w-8 h-8 text-purple-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">2</div>
          <div className="text-sm text-gray-400">Pending Invites</div>
        </div>
      </div>

      {/* Users Table */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Team Members</h3>
        <Table headers={headers} data={userData} actions />
      </div>

      {/* Roles Section */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Roles & Permissions</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {roles.map((role, index) => (
            <div key={index} className="section-card">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-white">{role.name}</h4>
                <span className={`px-2 py-1 bg-${role.color}-600/20 text-${role.color}-400 rounded-full text-xs font-medium`}>
                  Role
                </span>
              </div>
              <p className="text-sm text-gray-300 mb-4">{role.description}</p>
              <div>
                <div className="text-xs font-medium text-gray-400 mb-2">PERMISSIONS</div>
                <div className="space-y-1">
                  {role.permissions.map((permission, permIndex) => (
                    <div key={permIndex} className="text-xs text-gray-300">
                      • {permission}
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={() => alert(`Edit ${role.name} role functionality`)}
                className="w-full mt-4 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Edit Role
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for user management and role-based access control */}
          User and role management is UI-only. Connect to backend for authentication and permissions.
        </p>
      </div>
    </div>
  );
}