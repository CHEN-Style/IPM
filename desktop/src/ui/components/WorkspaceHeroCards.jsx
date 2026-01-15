import React from 'react';
import { MoreHorizontal } from 'lucide-react';

const COLOR = Object.freeze({
  blue: {
    halo: 'bg-blue-50',
    icon: 'bg-blue-50 text-blue-600',
    active: 'text-blue-600',
    dot: 'bg-blue-400',
  },
  emerald: {
    halo: 'bg-emerald-50',
    icon: 'bg-emerald-50 text-emerald-600',
    active: 'text-emerald-600',
    dot: 'bg-emerald-400',
  },
  amber: {
    halo: 'bg-amber-50',
    icon: 'bg-amber-50 text-amber-600',
    active: 'text-amber-600',
    dot: 'bg-amber-400',
  },
});

export const WorkspaceHeroCard = ({ title, Icon, count, active, colorKey, features, onClick }) => {
  const c = COLOR[colorKey] || COLOR.blue;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.();
      }}
      className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group flex flex-col h-full relative overflow-hidden outline-none focus:ring-2 focus:ring-slate-200"
    >
      <div className={`absolute top-0 right-0 w-24 h-24 ${c.halo} rounded-full -mr-8 -mt-8 opacity-50 group-hover:scale-110 transition-transform`} />

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${c.icon}`}>
            <Icon className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
        <MoreHorizontal className="w-4 h-4 text-slate-300 hover:text-slate-500" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1">总规模</p>
          <p className="text-xl font-bold text-slate-900">{count ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1">活跃中</p>
          <p className={`text-xl font-bold ${c.active}`}>{active ?? '-'}</p>
        </div>
      </div>

      <div className="mt-auto space-y-2 relative z-10">
        {(features || []).map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
            <div className={`w-1 h-1 rounded-full ${c.dot}`} />
            <span className="truncate">{f}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 relative z-10">
        <span>最近更新 2小时前</span>
        <span className="group-hover:translate-x-1 transition-transform">进入文件夹 →</span>
      </div>
    </div>
  );
};

export const WorkspaceHeroCards = ({ cards = [] }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map((c) => (
        <WorkspaceHeroCard key={c.key || c.title} {...c} />
      ))}
    </div>
  );
};

export default WorkspaceHeroCards;


