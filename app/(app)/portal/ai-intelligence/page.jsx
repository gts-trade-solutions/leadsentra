import SectionHeader from '@/components/SectionHeader';
import ActivityItem from '@/components/ActivityItem';
import StatCard from '@/components/StatCard';
import { Brain, TrendingUp, Target, Lightbulb } from 'lucide-react';

export default function AiIntelligencePage() {
  const recommendations = [
    {
      id: 1,
      type: 'contact',
      description: 'High-value prospect Sarah Johnson from TechCorp shows strong engagement signals',
      time: '2 hours ago',
      user: 'AI Assistant'
    },
    {
      id: 2,
      type: 'deal',
      description: 'Enterprise Corp deal has 85% probability of closing based on engagement patterns',
      time: '4 hours ago',
      user: 'AI Assistant'
    },
    {
      id: 3,
      type: 'email',
      description: 'Optimal send time for your audience is Tuesday 10 AM based on open rate analysis',
      time: '1 day ago',
      user: 'AI Assistant'
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="AI Intelligence"
        description="Get AI-powered insights and recommendations to optimize your sales performance"
      />

      {/* AI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="AI Recommendations"
          value="23"
          icon={Lightbulb}
          badge="New"
        />
        <StatCard
          title="Prediction Accuracy"
          value="87.3%"
          icon={Target}
          change="+2.1%"
          changeType="positive"
        />
        <StatCard
          title="Leads Scored"
          value="1,247"
          icon={TrendingUp}
        />
        <StatCard
          title="Insights Generated"
          value="156"
          icon={Brain}
        />
      </div>

      {/* AI Insights Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5 text-emerald-400" />
            Smart Recommendations
          </h3>
          <div className="space-y-1">
            {recommendations.map((recommendation) => (
              <ActivityItem key={recommendation.id} activity={recommendation} />
            ))}
          </div>
        </div>

        <div className="section-card">
          <h3 className="text-lg font-semibold text-white mb-4">Lead Scoring Insights</h3>
          <div className="space-y-4">
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">High-Value Prospects</span>
                <span className="text-sm font-medium text-emerald-400">47 leads</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '78%' }}></div>
              </div>
            </div>
            
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Medium Priority</span>
                <span className="text-sm font-medium text-yellow-400">123 leads</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div className="bg-yellow-500 h-2 rounded-full" style={{ width: '45%' }}></div>
              </div>
            </div>

            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Nurture Required</span>
                <span className="text-sm font-medium text-blue-400">89 leads</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '32%' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-gray-400">
          {/* TODO: connect to backend for AI-powered insights and recommendations */}
          AI intelligence features are using mock data. Connect to backend for real AI-powered insights.
        </p>
      </div>
    </div>
  );
}