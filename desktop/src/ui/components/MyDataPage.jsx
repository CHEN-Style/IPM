import React, { useMemo } from 'react';
import { Briefcase, FolderKanban, GraduationCap } from 'lucide-react';
import ProjectManager from './ProjectManager.jsx';
import WorkspaceHeroCards from './WorkspaceHeroCards.jsx';

const MyDataPage = ({ section = 'home', onSectionChange, stats }) => {
  const meta = useMemo(() => {
    if (section === 'cases') return { title: '案件', domain: 'cases' };
    if (section === 'projects') return { title: '项目', domain: 'projects' };
    if (section === 'study') return { title: '学习', domain: 'study' };
    return { title: '我的资料', domain: '' };
  }, [section]);

  if (section === 'projects' || section === 'cases') {
    return (
      <ProjectManager domain={meta.domain} onBackHome={() => onSectionChange?.('home')} />
    );
  }
  if (section === 'study') {
    return <ProjectManager domain="study" onBackHome={() => onSectionChange?.('home')} />;
  }

  const cards = [
    {
      key: 'cases',
      title: '案件',
      Icon: Briefcase,
      count: stats?.cases?.count ?? null,
      active: stats?.cases?.active ?? null,
      colorKey: 'blue',
      features: ['诉讼 / 仲裁', '法律顾问', '非诉专项'],
      onClick: () => onSectionChange?.('cases'),
    },
    {
      key: 'projects',
      title: '项目',
      Icon: FolderKanban,
      count: stats?.projects?.count ?? null,
      active: stats?.projects?.active ?? null,
      colorKey: 'emerald',
      features: ['合规体系建设', '知识库迁移', '年度审计'],
      onClick: () => onSectionChange?.('projects'),
    },
    {
      key: 'study',
      title: '学习',
      Icon: GraduationCap,
      count: stats?.study?.count ?? null,
      active: stats?.study?.active ?? 1,
      colorKey: 'amber',
      features: ['法条解读', '实务文章', '裁判观点'],
      onClick: () => onSectionChange?.('study'),
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">我的资料</h1>
          <p className="text-xs text-slate-500 mt-0.5">请选择入口：案件 / 项目 / 学习</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          <WorkspaceHeroCards cards={cards} />
        </div>
      </div>
    </div>
  );
};

export default MyDataPage;


