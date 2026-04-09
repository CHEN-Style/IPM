import React, { useCallback, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Brain, Plus, ShieldCheck } from 'lucide-react';
import ClassifyRulesPanel from './ClassifyRulesPanel.jsx';
import ClassifyEventsTab from './ClassifyEventsTab.jsx';
import PreferencesPanel from './PreferencesPanel.jsx';

const TABS = [
  { id: 'rules', label: '硬规则', icon: ShieldCheck, desc: '确定性的快速通道规则，命中后跳过 AI 直接分类' },
  { id: 'preferences', label: '软偏好', icon: Brain, desc: '从使用习惯中提炼的概率性分类倾向' },
  { id: 'events', label: '原始事件', icon: BookOpen, desc: '所有分类活动与用户反馈的完整记录' },
];

const ADD_LABELS = { rules: '添加规则', preferences: '手动添加' };

const PreferencesPage = ({ projectName, domain, onBack }) => {
  const [activeTab, setActiveTab] = useState('rules');
  const addTriggerRef = useRef(null);

  const handleHeaderAdd = useCallback(() => {
    addTriggerRef.current?.();
  }, []);

  const showAddBtn = activeTab === 'rules' || activeTab === 'preferences';

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

        {/* Tab bar + add button */}
        <div className="flex items-center justify-between">
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
                  data-tour={`pref-tab-${tab.id}`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {showAddBtn && (
            <button
              type="button"
              onClick={handleHeaderAdd}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] font-medium transition-colors shadow-sm"
            >
              <Plus size={13} />
              {ADD_LABELS[activeTab]}
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'rules' && (
          <ClassifyRulesPanel
            projectName={projectName}
            domain={domain}
            embedded
            addTriggerRef={addTriggerRef}
          />
        )}

        {activeTab === 'preferences' && (
          <PreferencesPanel
            projectName={projectName}
            domain={domain}
            embedded
            addTriggerRef={addTriggerRef}
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
