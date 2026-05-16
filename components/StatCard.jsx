import { cn } from '@/lib/utils';

export default function StatCard({ title, value, icon: Icon, change, changeType, badge, className }) {
  return (
    <div className={cn('stat-card hover:bg-gray-750 transition-colors cursor-pointer', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-400 mb-1">{title}</div>
          <div className="text-2xl font-bold text-white mb-2">{value}</div>
          {change && (
            <div className={cn(
              'text-xs font-medium',
              changeType === 'positive' ? 'text-emerald-400' : 'text-red-400'
            )}>
              {changeType === 'positive' ? '+' : ''}{change}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {Icon && (
            <div className="w-10 h-10 bg-emerald-600/20 rounded-lg flex items-center justify-center">
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
          )}
          {badge && (
            <span className="px-2 py-1 bg-emerald-600/20 text-emerald-400 text-xs font-medium rounded-full">
              {badge}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}