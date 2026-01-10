import React, { useMemo, useState } from 'react';
import { Briefcase, FolderKanban, GraduationCap } from 'lucide-react';
import ProjectManager from './ProjectManager.jsx';

const Card = ({ title, desc, icon, onClick, disabled }) => {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group w-full text-left bg-white rounded-2xl border shadow-sm p-6 transition-all ${
        disabled
          ? 'border-slate-200 opacity-60 cursor-not-allowed'
          : 'border-slate-200 hover:shadow-md hover:border-indigo-200 cursor-pointer'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">{title}</div>
          <div className="text-sm text-slate-500 mt-1 leading-relaxed">{desc}</div>
          {disabled ? <div className="text-xs text-slate-400 mt-3">暂未开放</div> : null}
        </div>
      </div>
    </button>
  );
};

const MyDataPage = () => {
  const [section, setSection] = useState('home'); // home | projects | cases | study
  const meta = useMemo(() => {
    if (section === 'cases') return { title: '案件', domain: 'cases' };
    if (section === 'projects') return { title: '项目', domain: 'projects' };
    if (section === 'study') return { title: '学习', domain: 'study' };
    return { title: '我的资料', domain: '' };
  }, [section]);

  if (section === 'projects' || section === 'cases') {
    return (
      <ProjectManager domain={meta.domain} onBackHome={() => setSection('home')} />
    );
  }
  if (section === 'study') {
    return <ProjectManager domain="study" onBackHome={() => setSection('home')} />;
  }

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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              title="案件"
              desc="业务相关案件。二级目录为用户自定义（常用作客户/事项分类），内置固定的办案流程目录。"
              icon={<Briefcase size={20} />}
              onClick={() => setSection('cases')}
            />
            <Card
              title="项目"
              desc="非业务类项目、课题、活动、会议等。内置固定的资料收集/过程文档/研究/交付目录。"
              icon={<FolderKanban size={20} />}
              onClick={() => setSection('projects')}
            />
            <Card
              title="学习"
              desc="个人学习与资料收集、信息检索、条款与模板沉淀等。"
              icon={<GraduationCap size={20} />}
              onClick={() => setSection('study')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyDataPage;


