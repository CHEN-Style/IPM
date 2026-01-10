import React, { useMemo, useState } from 'react';
import {
  Search,
  LayoutGrid,
  Briefcase,
  FolderKanban,
  BookOpen,
  Clock,
  BarChart3,
  FileText,
  MoreHorizontal,
  ArrowUpRight,
  Zap,
  Layers,
} from 'lucide-react';

// 复刻 DESIGN-GUIDE/proworkspace-hub（仅前端样式与 mock 数据；不接真实数据）

// --- Mock Data ---
const GLOBAL_STATS = [
  {
    id: '1',
    label: '知识资产总数',
    value: '142',
    subValue: '本周 +5',
    trend: 'up',
    Icon: Layers,
    colorClass: 'text-blue-600 bg-blue-50',
  },
  {
    id: '2',
    label: '文档/笔记规模',
    value: '38.2k 字',
    subValue: '结构化程度 85%',
    trend: 'neutral',
    Icon: FileText,
    colorClass: 'text-indigo-600 bg-indigo-50',
  },
  {
    id: '3',
    label: '高优待办',
    value: '8',
    subValue: '分布于 3 个案件',
    trend: 'down',
    Icon: Zap,
    colorClass: 'text-amber-600 bg-amber-50',
  },
  {
    id: '4',
    label: '平均关联深度',
    value: '4.2',
    subValue: '文件间引用率',
    trend: 'up',
    Icon: LayoutGrid,
    colorClass: 'text-slate-600 bg-slate-100',
  },
];

const RECENT_ACTIVITY = [
  {
    id: 'a1',
    title: '合同纠纷：解除权行使的时间与通知要点',
    description: '整理了解除权期限、通知送达路径及举证思路，补充了最高院指导案例 15 号。',
    date: '10分钟前',
    type: 'case',
    tags: ['合同法', '诉讼策略'],
  },
  {
    id: 'a2',
    title: 'Q1 内部审计项目：合规性检查清单',
    description: '更新了劳动用工合规部分的检查项，特别是关于竞业限制的条款审核。',
    date: '2小时前',
    type: 'project',
    tags: ['合规', '审计'],
  },
  {
    id: 'a3',
    title: '民法典担保制度解释学习笔记',
    description: '完成了关于“非典型担保”章节的思维导图构建。',
    date: '昨天',
    type: 'learning',
    tags: ['民法典', '担保物权'],
  },
];

const FOCUS_ITEMS = [
  {
    id: 'f1',
    type: 'case',
    title: '劳动争议：仲裁举证清单与争点拆解模板',
    summary: '把争点拆成“事实—证据—法律依据—请求”四维结构，并准备一份可复用的证据目录与来源说明。需重点关注加班费计算基数。',
    deadline: '2026/1/5',
    priority: 'high',
    tags: ['劳动仲裁', '加班费', '证据链'],
  },
  {
    id: 'f2',
    type: 'project',
    title: '知识库迁移：旧系统数据清洗方案',
    summary: '确定元数据映射规则，特别是关于“案件阶段”与“文档类型”的标签对齐。需要与技术团队确认最终的 JSON 导入格式。',
    deadline: '2026/1/10',
    priority: 'medium',
    tags: ['数据治理', '系统迁移'],
  },
  {
    id: 'f3',
    type: 'case',
    title: '民间借贷：利息、逾期利息与证据链闭合',
    summary: '围绕“借款合意 + 交付 + 约定利息/还款 + 催收”构建证据链，避免只剩转账没有借条。',
    deadline: '2025/12/29',
    priority: 'high',
    tags: ['民间借贷', '利息', '证据链'],
  },
];

const CHART_DATA = [
  { name: '送达', value: 8 },
  { name: '争点', value: 7 },
  { name: '合同', value: 5 },
  { name: '解除权', value: 5 },
  { name: '证据', value: 4 },
  { name: '劳动仲裁', value: 4 },
  { name: '加班', value: 3 },
];

// --- Components ---
const Header = () => (
  <header className="flex items-center justify-between py-6 mb-2">
    <div>
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">知识库总览</h1>
      <p className="text-sm text-slate-500 mt-1">从全局视角查看你的办案知识资产与项目进度。</p>
    </div>
    <div className="flex items-center gap-4">
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
        <input
          type="text"
          placeholder="筛选当前视图 (⌘K)"
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

const COLOR = Object.freeze({
  blue: {
    halo: 'bg-blue-50',
    icon: 'bg-blue-50 text-blue-600',
    active: 'text-blue-600',
    dot: 'bg-blue-400',
    ring: 'border-blue-200',
  },
  emerald: {
    halo: 'bg-emerald-50',
    icon: 'bg-emerald-50 text-emerald-600',
    active: 'text-emerald-600',
    dot: 'bg-emerald-400',
    ring: 'border-emerald-200',
  },
  amber: {
    halo: 'bg-amber-50',
    icon: 'bg-amber-50 text-amber-600',
    active: 'text-amber-600',
    dot: 'bg-amber-400',
    ring: 'border-amber-200',
  },
});

const FolderCard = ({ title, Icon, count, active, colorKey, features }) => {
  const c = COLOR[colorKey] || COLOR.blue;
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group flex flex-col h-full relative overflow-hidden">
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
          <p className="text-xl font-bold text-slate-900">{count}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1">活跃中</p>
          <p className={`text-xl font-bold ${c.active}`}>{active}</p>
        </div>
      </div>

      <div className="mt-auto space-y-2 relative z-10">
        {features.map((f, i) => (
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

const OverviewPage = () => {
  // 仅复刻 UI：留一个轻量 state 以便后续扩展交互
  const [_view, _setView] = useState('default');

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 font-sans p-4 md:p-8 max-w-[1600px] mx-auto w-full">
      <Header />

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {GLOBAL_STATS.map((stat) => (
          <StatCard key={stat.id} metric={stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left/Main Column: Folders & Focus */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Three Main Folders - Entry Points */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FolderCard title="案件" Icon={Briefcase} count={24} active={5} colorKey="blue" features={['诉讼 / 仲裁', '法律顾问', '非诉专项']} />
            <FolderCard title="项目" Icon={FolderKanban} count={12} active={3} colorKey="emerald" features={['合规体系建设', '知识库迁移', '年度审计']} />
            <FolderCard title="学习" Icon={BookOpen} count={106} active={8} colorKey="amber" features={['法条解读', '实务文章', '裁判观点']} />
          </div>

          {/* Today's Focus Section */}
          <div className="bg-indigo-50/50 rounded-2xl p-6 border border-indigo-100">
            <SectionHeader Icon={Zap} title="今日重点复盘" action="换一组" />
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
            <SectionHeader Icon={BarChart3} title="热门标签分布" />
            <div className="flex-grow mt-2">
              <TagChart />
            </div>
          </div>

          {/* Activity Feed */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex-grow">
            <SectionHeader Icon={Clock} title="最近新增" action="查看全部" />
            <ActivityFeed />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewPage;


