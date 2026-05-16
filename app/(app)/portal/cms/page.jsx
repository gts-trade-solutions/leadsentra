'use client';

import SectionHeader from '@/components/SectionHeader';
import Table from '@/components/Table';
import { Plus, FileText, Image, Video, Edit } from 'lucide-react';

export default function CmsPage() {
  const headers = ['Title', 'Type', 'Status', 'Last Updated', 'Author'];
  
  const contentData = [
    {
      title: 'Getting Started Guide',
      type: (
        <span className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          Article
        </span>
      ),
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Published
        </span>
      ),
      lastUpdated: '2024-01-15',
      author: 'John Doe',
    },
    {
      title: 'Product Demo Video',
      type: (
        <span className="flex items-center gap-1">
          <Video className="w-3 h-3" />
          Video
        </span>
      ),
      status: (
        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded-full text-xs font-medium">
          Draft
        </span>
      ),
      lastUpdated: '2024-01-14',
      author: 'Jane Smith',
    },
    {
      title: 'Feature Announcement',
      type: (
        <span className="flex items-center gap-1">
          <Image className="w-3 h-3" />
          Blog Post
        </span>
      ),
      status: (
        <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded-full text-xs font-medium">
          Published
        </span>
      ),
      lastUpdated: '2024-01-13',
      author: 'Mike Wilson',
    },
  ];

  const contentTypes = [
    { name: 'Articles', count: 24, icon: FileText, color: 'blue' },
    { name: 'Blog Posts', count: 18, icon: Edit, color: 'green' },
    { name: 'Videos', count: 12, icon: Video, color: 'purple' },
    { name: 'Images', count: 156, icon: Image, color: 'orange' },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Content Management"
        description="Manage your website content, documentation, and media"
      >
        <button 
          onClick={() => alert('Create new content functionality')}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Content
        </button>
      </SectionHeader>

      {/* Content Type Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {contentTypes.map((type, index) => {
          const Icon = type.icon;
          return (
            <div key={index} className="section-card text-center">
              <Icon className={`w-8 h-8 text-${type.color}-400 mx-auto mb-2`} />
              <div className="text-2xl font-bold text-white">{type.count}</div>
              <div className="text-sm text-gray-400">{type.name}</div>
            </div>
          );
        })}
      </div>

      {/* Search and Filters */}
      <div className="section-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Search content..."
            onChange={(e) => console.log('Search:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          />
          <select 
            onChange={(e) => console.log('Type filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Types</option>
            <option>Articles</option>
            <option>Blog Posts</option>
            <option>Videos</option>
          </select>
          <select 
            onChange={(e) => console.log('Status filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Status</option>
            <option>Published</option>
            <option>Draft</option>
          </select>
          <select 
            onChange={(e) => console.log('Author filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Authors</option>
            <option>John Doe</option>
            <option>Jane Smith</option>
          </select>
        </div>
      </div>

      {/* Content Table */}
      <Table headers={headers} data={contentData} actions />

      {/* Quick Actions */}
      <div className="section-card">
        <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => alert('Create article functionality')}
            className="p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
          >
            <FileText className="w-6 h-6 text-blue-400 mb-2" />
            <div className="font-medium text-white text-sm mb-1">Create Article</div>
            <div className="text-xs text-gray-400">Write a new help article</div>
          </button>
          
          <button
            onClick={() => alert('Create blog post functionality')}
            className="p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
          >
            <Edit className="w-6 h-6 text-green-400 mb-2" />
            <div className="font-medium text-white text-sm mb-1">New Blog Post</div>
            <div className="text-xs text-gray-400">Publish company updates</div>
          </button>
          
          <button
            onClick={() => alert('Upload media functionality')}
            className="p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
          >
            <Image className="w-6 h-6 text-orange-400 mb-2" />
            <div className="font-medium text-white text-sm mb-1">Upload Media</div>
            <div className="text-xs text-gray-400">Add images and videos</div>
          </button>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for content management system */}
          Content management is UI-only. Connect to backend for real CMS functionality.
        </p>
      </div>
    </div>
  );
}