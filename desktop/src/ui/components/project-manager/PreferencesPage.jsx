import React, { useState } from 'react';
import { ArrowLeft, BookOpen, Brain, ShieldCheck } from 'lucide-react';
import ClassifyRulesPanel from './ClassifyRulesPanel.jsx';
import ClassifyEventsTab from './ClassifyEventsTab.jsx';
import PreferencesPanel from './PreferencesPanel.jsx';

const TABS = [
  { id: 'rules', label: '硬规则', icon: ShieldCheck, desc: '确定性的快速通道规则，命中后跳过 AI 直接分类' },
  { id: 'preferences', label: '软偏好', icon: Brain, desc: '从使用习惯中提炼的概率性分类倾向' },
  { id: 'events', label: '原始事件', icon: BookOpen, desc: '所有分类活动与用户反馈的完整记录' },
];

const PreferencesPage = ({ projectName, domain, onBack }) => {
  const [activeTab, setActiveTab] = useState('rules');

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8f9fb]">
      {/* Header */}
      <div className="px-8 py-5 border-b border-[#e2e4eb] bg-white">
        <div className="flex items-center gap-4 mb-4">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
            title="返回项目列表"
          >
            <ArrowLeft size={18} className="text-slate-500" />
          </button>
          <div>
            <div className="text-base font-semibold text-slate-800">偏好与记录</div>
            <div className="text-xs text-slate-400 mt-0.5">{projectName}</div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-[#f0f1f5] rounded-lg p-1 w-fit">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-[#2f3545] shadow-sm'
                    : 'text-[#6e7389] hover:text-[#414659] hover:bg-white/50'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'rules' && (
          <ClassifyRulesPanel
            projectName={projectName}
            domain={domain}
            embedded
          />
        )}

        {activeTab === 'preferences' && (
          <PreferencesPanel
            projectName={projectName}
            domain={domain}
            embedded
          />
        )}

        {activeTab === 'events' && (
          <ClassifyEventsTab projectName={projectName} domain={domain} />
        )}
      </div>
    </div>
  );
};

export default PreferencesPage;
