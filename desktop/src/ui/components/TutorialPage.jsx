import React, { useState } from 'react';
import {
  GraduationCap,
  FolderPlus,
  Layers,
  Play,
  BookOpen,
  Sparkles,
  StickyNote,
  ShieldCheck,
} from 'lucide-react';
import { useTour } from './tour/TourProvider.jsx';
import './tour/tours/createProjectTour.js';
import './tour/tours/floatingModeTour.js';
import './tour/tours/createNoteTour.js';
import './tour/tours/createHardRuleTour.js';
import guideHtml from '../../../../docs/guide.html?raw';

const TOUR_CARDS = [
  {
    id: 'create-project',
    title: '创建项目与文件上传',
    description: '从零开始创建一个项目，学会使用普通上传和 AI 分类上传功能。',
    steps: 7,
    icon: FolderPlus,
    color: '#4a9e8e',
    tags: ['入门', '项目管理', '文件上传'],
  },
  {
    id: 'floating-mode',
    title: '开启悬浮窗模式',
    description: '学会如何从主界面切换到悬浮窗模式。',
    steps: 3,
    icon: Layers,
    color: '#6366f1',
    tags: ['悬浮窗', '模式切换'],
  },
  {
    id: 'create-note',
    title: '新建笔记碎片',
    description: '进入已有项目的知识管理页面，学会创建一条富文本笔记碎片。',
    steps: 7,
    icon: StickyNote,
    color: '#d97706',
    tags: ['知识碎片', '笔记', '知识管理'],
  },
  {
    id: 'create-hard-rule',
    title: '创建硬规则',
    description: '为项目添加一条分类硬规则，命中后跳过 AI 直接将文件归入指定文件夹。',
    steps: 9,
    icon: ShieldCheck,
    color: '#3e4b9c',
    tags: ['偏好与记录', '硬规则', '自动分类'],
  },
];

const TABS = [
  { key: 'tour', label: '交互式引导', Icon: Sparkles, iconColor: 'text-amber-500' },
  { key: 'docs', label: '完整图文教程', Icon: BookOpen, iconColor: 'text-blue-500' },
];

function TourCard({ card, onStart }) {
  const [hovered, setHovered] = useState(false);
  const Icon = card.icon;
  return (
    <div
      className="relative rounded-2xl border border-slate-200 bg-white overflow-hidden transition-all duration-200 flex flex-col"
      style={{
        boxShadow: hovered ? '0 8px 24px -8px rgba(0,0,0,0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${card.color}12` }}
          >
            <Icon size={20} style={{ color: card.color }} />
          </div>
          <span className="text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
            {card.steps} 步
          </span>
        </div>
        <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5 leading-snug">{card.title}</h3>
        <p className="text-[12px] text-slate-500 leading-relaxed mb-4 flex-1">{card.description}</p>
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {card.tags.map((tag) => (
            <span key={tag} className="text-[10px] text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
        <button
          onClick={() => onStart(card.id)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium text-white transition-all duration-200"
          style={{
            background: hovered ? card.color : `${card.color}dd`,
            boxShadow: hovered ? `0 4px 12px ${card.color}40` : 'none',
          }}
        >
          <Play size={14} />
          开始引导
        </button>
      </div>
    </div>
  );
}

export default function TutorialPage() {
  const { startTour } = useTour();
  const [activeTab, setActiveTab] = useState('tour');

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header + Tabs */}
      <div className="shrink-0 px-8 border-b border-slate-200" style={{ background: '#f8f9fb' }}>
        <div className="max-w-[960px] mx-auto flex items-end gap-6">
          {/* Title */}
          <div className="flex items-center gap-2 pb-2.5 shrink-0">
            <GraduationCap size={16} className="text-indigo-600 shrink-0" />
            <h1 className="text-[14px] font-semibold text-slate-900 leading-none">教程中心</h1>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0.5">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium transition-colors rounded-t-md ${
                    isActive
                      ? 'text-slate-800 bg-white'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                  style={isActive ? { marginBottom: -1, borderBottom: '1px solid white' } : { marginBottom: -1 }}
                >
                  <tab.Icon size={12} className={isActive ? tab.iconColor : 'text-slate-400'} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'tour' ? (
          <div className="h-full overflow-y-auto">
            <div className="max-w-[960px] mx-auto px-8 pt-8 pb-16">
              <p className="text-[12px] text-slate-500 mb-6 leading-relaxed">
                点击「开始引导」后，系统会在应用界面中逐步高亮关键位置并弹出提示气泡，引导你完成操作。你可以随时按 <kbd className="text-[10px] px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono">Esc</kbd> 或点击「跳过」结束引导。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {TOUR_CARDS.map((card) => (
                  <TourCard key={card.id} card={card} onStart={startTour} />
                ))}
              </div>

              {/* Placeholder for future tours */}
              <div className="mt-12 pt-8 border-t border-slate-100">
                <h3 className="text-[13px] font-semibold text-slate-400 mb-2">更多教程即将推出</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  悬浮窗文件上传、Knowledge Board 等进阶功能的交互式引导正在开发中。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            srcDoc={guideHtml}
            className="w-full h-full border-0"
            style={{ background: 'white' }}
            sandbox="allow-scripts allow-same-origin"
            title="KnowVault 使用教程"
          />
        )}
      </div>
    </div>
  );
}
