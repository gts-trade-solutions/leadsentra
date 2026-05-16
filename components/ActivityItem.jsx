import { Mail, User, TrendingUp, Upload, Calendar } from 'lucide-react';

export default function ActivityItem({ activity }) {
  const getIcon = (type) => {
    const icons = {
      email: Mail,
      contact: User,
      deal: TrendingUp,
      import: Upload,
      meeting: Calendar,
    };
    const Icon = icons[type] || Mail;
    return <Icon className="w-4 h-4" />;
  };

  const getIconColor = (type) => {
    const colors = {
      email: 'text-blue-400 bg-blue-400/20',
      contact: 'text-emerald-400 bg-emerald-400/20',
      deal: 'text-purple-400 bg-purple-400/20',
      import: 'text-orange-400 bg-orange-400/20',
      meeting: 'text-pink-400 bg-pink-400/20',
    };
    return colors[type] || 'text-gray-400 bg-gray-400/20';
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-800/70 transition-colors cursor-pointer">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getIconColor(activity.type)}`}>
        {getIcon(activity.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 leading-relaxed">
          {activity.description}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500">{activity.time}</span>
          <span className="text-xs text-gray-500">·</span>
          <span className="text-xs text-gray-500">{activity.user}</span>
        </div>
      </div>
    </div>
  );
}