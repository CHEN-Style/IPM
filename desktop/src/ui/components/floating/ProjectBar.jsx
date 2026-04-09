import React from 'react';
import { Briefcase, Folder, GraduationCap } from 'lucide-react';

const ProjectBar = ({ projects, activeProjectId, onSelect, title = 'Active Projects', icon = 'projects', emptyText = '暂无可用条目' }) => {
  const Icon = icon === 'cases' ? Briefcase : icon === 'study' ? GraduationCap : Briefcase;
  return (
    <div className="w-full bg-slate-100/80 border-t border-slate-200 backdrop-blur-sm rounded-b-xl overflow-hidden flex flex-col" data-tour="float-project-bar">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1">
        <Icon size={10} />
        <span>{title}</span>
      </div>
      <div className="flex overflow-x-auto scrollbar-hide px-1 pb-1 gap-0.5">
        {!projects.length ? (
          <div className="px-3 py-2 text-xs text-slate-400">{emptyText}</div>
        ) : null}
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          return (
            <button
              key={project.id}
              onClick={() => onSelect?.(project.id)}
              className={`
                relative flex items-center gap-2 px-4 py-2 text-xs font-medium transition-all duration-200 whitespace-nowrap rounded-t-lg
                ${isActive ? 'bg-white text-slate-800 shadow-sm z-10' : 'bg-transparent text-slate-500 hover:bg-slate-200/50 hover:text-slate-700'}
              `}
            >
              <Folder size={12} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
              <div className="flex flex-col items-start leading-none">
                <span>{project.label ?? project.name ?? project.id}</span>
              </div>
              {isActive && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 rounded-t-full" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectBar;


