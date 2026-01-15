import React, { useMemo, useState } from 'react';
import {
  Search,
  LayoutGrid,
  Briefcase,
  FolderKanban,
  GraduationCap,
  Clock,
  BarChart3,
  FileText,
  ArrowUpRight,
  Zap,
  Layers,
  Users,
  Cloud,
  MessageSquare,
} from 'lucide-react';
import WorkspaceHeroCards from './WorkspaceHeroCards.jsx';

// 复刻 DESIGN-GUIDE/proworkspace-hub（UI 为主；三大入口卡片接真实统计）

// --- Mock Data (聚焦“我的资料” + 协作/云端；后续接后台服务可直接替换) ---
const buildGlobalStats = (stats) => {
  const casesActive = Number.isFinite(stats?.cases?.active) ? stats.cases.active : null;
  const projectsActive = Number.isFinite(stats?.projects?.active) ? stats.projects.active : null;
  const activeWork = [casesActive, projectsActive].every((x) => typeof x === 'number') ? casesActive + projectsActive : null;

  return [
    {
      id: 's1',
      label: '活跃协作事项',
      value: activeWork != null ? String(activeWork) : '—',
      subValue: '案件 + 项目（本地统计）',
      trend: 'up',
      Icon: Users,
      colorClass: 'text-indigo-600 bg-indigo-50',
    },
    {
      id: 's2',
      label: '待归档 / 待审阅',
      value: '6',
      subValue: '来自 AI 推荐与共享更新',
      trend: 'neutral',
      Icon: Zap,
      colorClass: 'text-amber-600 bg-amber-50',
    },
    {
      id: 's3',
      label: '本周新增资料',
      value: '18',
      subValue: '包含拖拽上传 / 截图 / 剪贴',
      trend: 'up',
      Icon: FileText,
      colorClass: 'text-emerald-600 bg-emerald-50',
    },
    {
      id: 's4',
      label: '云端协作空间',
      value: '2',
      subValue: '已连接 · 同步正常（mock）',
      trend: 'up',
      Icon: Cloud,
      colorClass: 'text-blue-600 bg-blue-50',
    },
  ];
};

const RECENT_ACTIVITY = [
  {
    id: 'a1',
    title: '你将「补充材料（截图）」共享到：案件 / 乙方合同纠纷',
    description: '来源于微信缓存目录，已进入 temp 并生成 AI 推荐：优先考虑归入「收到资料」。',
    date: '8分钟前',
    type: 'case',
    tags: ['共享', 'AI推荐', '收到资料'],
  },
  {
    id: 'a2',
    title: '协作更新：@你审阅「交付成果/律师函（定稿）.docx」',
    description: '云端协作空间 “ACME-合规专项” 更新了交付版本，等待你确认并归档。',
    date: '1小时前',
    type: 'project',
    tags: ['云端', '待审阅', '交付成果'],
  },
  {
    id: 'a3',
    title: '团队评论：对「过程文档/风险清单_v3.docx」新增 3 条批注',
    description: '协作者对关键条款提出修改建议，建议你在过程文档中保留版本迭代记录。',
    date: '昨天',
    type: 'project',
    tags: ['评论', '过程文档', '版本'],
  },
  {
    id: 'a4',
    title: '学习库同步：新增「模板/条款模板」条目 5 个（mock）',
    description: '来自热门云端知识库的条款示例，已同步到学习库，便于后续复用。',
    date: '2天前',
    type: 'learning',
    tags: ['云端', '模板', '学习'],
  },
];

const FOCUS_ITEMS = [
  {
    id: 'f1',
    type: 'case',
    title: '案件：核对客户补充材料并确认归档目录',
    summary: '今天拖入的图片/聊天截图文件名较乱，先参考 sourceDir（wechat/WXWork）做二次判断，再确认是否归入「收到资料」。',
    deadline: '今天 18:00',
    priority: 'high',
    tags: ['待归档', '收到资料', 'AI推荐'],
  },
  {
    id: 'f2',
    type: 'project',
    title: '项目：整理「过程文档」版本并生成交付包（mock）',
    summary: '把 v1/v2/v3 工作稿归整到过程文档，挑出定稿并放入交付成果；同时准备共享给协作成员审阅。',
    deadline: '明天',
    priority: 'medium',
    tags: ['过程文档', '交付成果', '协作'],
  },
  {
    id: 'f3',
    type: 'project',
    title: '协作：处理云端空间的 @提及与评论（mock）',
    summary: '优先响应“待审阅”与“风险提示”评论，把决策记录沉淀到调研研究或过程文档，便于追溯。',
    deadline: '本周',
    priority: 'high',
    tags: ['@提及', '评论', '云端'],
  },
];

const CHART_DATA = [
  { name: '待归档', value: 9 },
  { name: '共享', value: 7 },
  { name: '待审阅', value: 6 },
  { name: '过程文档', value: 5 },
  { name: '收到资料', value: 5 },
  { name: '交付成果', value: 4 },
  { name: '模板', value: 3 },
];

// --- Components ---
const Header = () => (
  <header className="flex items-center justify-between py-6 mb-2">
    <div>
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">我的资料概览</h1>
      <p className="text-sm text-slate-500 mt-1">聚焦案件 / 项目 / 学习的资料流转，并预览协作与云端动态（mock）。</p>
    </div>
    <div className="flex items-center gap-4">
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
        <input
          type="text"
          placeholder="搜索我的资料 / 协作动态 (⌘K)"
          className="pl-9 pr-4 py-2 w-64 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition-all shadow-sm"
        />
      </div>
      <button
        type="button"
        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        title="视图（示例）"
      >
        <LayoutGrid className="w-5 h-5" />
      </button>
      <div className="w-8 h-8 rounded-full bg-slate-200 border border-white shadow-sm overflow-hidden flex items-center justify-center text-[10px] font-bold text-slate-600">
        JD
      </div>
    </div>
  </header>
);

const StatCard = ({ metric }) => (
  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.1)] transition-all duration-300 group">
    <div className="flex items-start justify-between mb-4">
      <div className={`p-2.5 rounded-lg ${metric.colorClass}`}>
        <metric.Icon className="w-5 h-5" />
      </div>
      {metric.trend === 'up' ? <ArrowUpRight className="w-4 h-4 text-emerald-500" /> : null}
    </div>
    <div>
      <div className="text-sm font-medium text-slate-500 mb-1">{metric.label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900 tracking-tight">{metric.value}</span>
        {metric.subValue ? <span className="text-xs text-slate-400 font-medium">{metric.subValue}</span> : null}
      </div>
    </div>
  </div>
);

const SectionHeader = ({ Icon, title, action }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-indigo-500" />
      <h2 className="text-base font-bold text-slate-800">{title}</h2>
    </div>
    {action ? (
      <button type="button" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded transition-colors">
        {action}
      </button>
    ) : null}
  </div>
);

const TagChart = () => {
  const data = useMemo(() => {
    const max = Math.max(1, ...CHART_DATA.map((d) => Number(d.value) || 0));
    return CHART_DATA.map((d, idx) => ({
      ...d,
      pct: Math.max(8, Math.round(((Number(d.value) || 0) / max) * 100)),
      strong: idx < 2,
    }));
  }, []);

  return (
    <div className="w-full h-full min-h-[200px] flex flex-col justify-center gap-3">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-3">
          <div className="w-16 text-xs text-slate-500 font-medium truncate">{d.name}</div>
          <div className="flex-1">
            <div className="h-3 bg-slate-100 rounded-md overflow-hidden border border-slate-200">
              <div className={`h-3 ${d.strong ? 'bg-indigo-500' : 'bg-slate-300'} rounded-md`} style={{ width: `${d.pct}%` }} />
            </div>
          </div>
          <div className="w-6 text-right text-xs text-slate-400 font-mono">{d.value}</div>
        </div>
      ))}
    </div>
  );
};

const ActivityFeed = () => (
  <div className="space-y-5">
    {RECENT_ACTIVITY.map((item) => (
      <div key={item.id} className="group cursor-pointer">
        <div className="flex justify-between items-start mb-1">
          <h4 className="text-sm font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors line-clamp-1">
            {item.title}
          </h4>
          <span className="text-xs text-slate-400 whitespace-nowrap ml-2">{item.date}</span>
        </div>
        <p className="text-xs text-slate-500 mb-2 leading-relaxed line-clamp-2">{item.description}</p>
        <div className="flex items-center gap-2">
          {item.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
              {tag}
            </span>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const FocusCard = ({ item }) => {
  const isCase = item.type === 'case';
  const tagColor = isCase ? 'bg-white text-indigo-700 shadow-sm' : 'bg-white text-slate-600 border border-slate-200';
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {item.tags.map((tag) => (
          <span key={tag} className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${tagColor}`}>
            {tag}
          </span>
        ))}
        {item.priority === 'high' ? <div className="ml-auto w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> : null}
      </div>

      <h3 className="text-base font-bold text-slate-900 mb-2 line-clamp-2 leading-snug">{item.title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed mb-4 flex-grow">{item.summary}</p>

      <div className="pt-4 border-t border-slate-50 flex justify-between items-center mt-auto">
        <span className="text-xs text-slate-400 font-medium">{item.deadline || '-'}</span>
        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer transition-colors">
          <ArrowUpRight className="w-3 h-3" />
        </div>
      </div>
    </div>
  );
};

const OverviewPage = ({ stats, onOpenDomain }) => {
  // 仅复刻 UI：留一个轻量 state 以便后续扩展交互
  const [_view, _setView] = useState('default');
  const globalStats = useMemo(() => buildGlobalStats(stats), [stats]);

  const cards = [
    {
      key: 'cases',
      title: '案件',
      Icon: Briefcase,
      count: stats?.cases?.count ?? null,
      active: stats?.cases?.active ?? null,
      colorKey: 'blue',
      features: ['诉讼 / 仲裁', '法律顾问', '非诉专项'],
      onClick: () => onOpenDomain?.('cases'),
    },
    {
      key: 'projects',
      title: '项目',
      Icon: FolderKanban,
      count: stats?.projects?.count ?? null,
      active: stats?.projects?.active ?? null,
      colorKey: 'emerald',
      features: ['合规体系建设', '知识库迁移', '年度审计'],
      onClick: () => onOpenDomain?.('projects'),
    },
    {
      key: 'study',
      title: '学习',
      Icon: GraduationCap,
      count: stats?.study?.count ?? null,
      active: stats?.study?.active ?? 1,
      colorKey: 'amber',
      features: ['法条解读', '实务文章', '裁判观点'],
      onClick: () => onOpenDomain?.('study'),
    },
  ];

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 font-sans p-4 md:p-8 max-w-[1600px] mx-auto w-full">
      <Header />

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {globalStats.map((stat) => (
          <StatCard key={stat.id} metric={stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left/Main Column: Folders & Focus */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Three Main Folders - Entry Points */}
          <WorkspaceHeroCards cards={cards} />

          {/* Today's Focus Section */}
          <div className="bg-indigo-50/50 rounded-2xl p-6 border border-indigo-100">
            <SectionHeader Icon={MessageSquare} title="今日协作重点" action="换一组" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {FOCUS_ITEMS.map((item) => (
                <FocusCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Visualizations & Feed */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Tag Distribution */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-[320px] flex flex-col">
            <SectionHeader Icon={BarChart3} title="资料流转热点（mock）" />
            <div className="flex-grow mt-2">
              <TagChart />
            </div>
          </div>

          {/* Activity Feed */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex-grow">
            <SectionHeader Icon={Clock} title="协作动态" action="查看全部" />
            <ActivityFeed />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewPage;


