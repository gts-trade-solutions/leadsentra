'use client';

import SectionHeader from '@/components/SectionHeader';
import { ShoppingCart, Eye, Download, Star } from 'lucide-react';

export default function DataMarketplacePage() {
  const datasets = [
    {
      id: 1,
      name: 'Fortune 500 Executive Contacts',
      description: 'Verified contact information for C-level executives at Fortune 500 companies',
      records: '12,500',
      price: '$2,499',
      rating: 4.8,
      category: 'Executive Data'
    },
    {
      id: 2,
      name: 'SaaS Startup Database',
      description: 'Comprehensive database of SaaS startups with funding information',
      records: '8,750',
      price: '$1,299',
      rating: 4.6,
      category: 'Startup Data'
    },
    {
      id: 3,
      name: 'Healthcare Decision Makers',
      description: 'Healthcare industry contacts including hospital administrators and doctors',
      records: '15,200',
      price: '$3,199',
      rating: 4.9,
      category: 'Healthcare'
    },
    {
      id: 4,
      name: 'E-commerce Merchants',
      description: 'Online retailers and e-commerce business owners contact database',
      records: '6,890',
      price: '$899',
      rating: 4.4,
      category: 'E-commerce'
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Data Marketplace"
        description="Discover and purchase premium datasets to expand your reach"
      />

      {/* Search and Filters */}
      <div className="section-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Search datasets..."
            onChange={(e) => console.log('Dataset search:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          />
          <select 
            onChange={(e) => console.log('Category filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>All Categories</option>
            <option>Executive Data</option>
            <option>Startup Data</option>
            <option>Healthcare</option>
            <option>E-commerce</option>
          </select>
          <select 
            onChange={(e) => console.log('Price range filter:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>Price Range</option>
            <option>Under $1,000</option>
            <option>$1,000 - $2,500</option>
            <option>$2,500+</option>
          </select>
          <select 
            onChange={(e) => console.log('Sort by:', e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
          >
            <option>Sort by Rating</option>
            <option>Price: Low to High</option>
            <option>Price: High to Low</option>
            <option>Most Records</option>
          </select>
        </div>
      </div>

      {/* Dataset Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {datasets.map((dataset) => (
          <div key={dataset.id} className="section-card">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-white mb-1">{dataset.name}</h3>
                <span className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">
                  {dataset.category}
                </span>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-emerald-400">{dataset.price}</div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  {dataset.rating}
                </div>
              </div>
            </div>
            
            <p className="text-sm text-gray-300 mb-4">{dataset.description}</p>
            
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-400">
                {dataset.records} records
              </span>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => alert(`Preview ${dataset.name} dataset`)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
              <button
                onClick={() => alert(`Purchase ${dataset.name} dataset for ${dataset.price}`)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <ShoppingCart className="w-4 h-4" />
                Purchase
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for data marketplace functionality */}
          Data marketplace is UI-only. Connect to backend for dataset purchasing and delivery.
        </p>
      </div>
    </div>
  );
}