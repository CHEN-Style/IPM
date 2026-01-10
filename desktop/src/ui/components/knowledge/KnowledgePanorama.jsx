import React, { useMemo, useState } from 'react';
import {
  Layout,
  Clock,
  Tag,
  Star,
  BookOpen,
  Search,
  Filter,
  BarChart2,
  List,
  Grid,
  TrendingUp,
  Layers,
  ChevronRight,
  Calendar,
  FileText,
  AlertCircle,
  X,
} from 'lucide-react';

const Importance = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
};

// Helper to generate dates relative to now (kept identical to DESIGN-GUIDE)
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

// Mock data（律师办案/法律主题；后续可对接真实项目数据）
const MOCK_SNIPPETS = [
  {
    id: '1',
    title: '合同纠纷：解除权行使的时间与通知要点',
    summary: '解除权期限、解除通知送达与举证思路：先把“时间线”讲清楚，再谈解除效力与责任承担。',
    content:
      '办案提示：先整理合同履行节点与违约事实（对方迟延、根本违约、拒绝履行等），再核对解除条件与解除权期限。解除通知建议采用可证明送达方式（EMS、电子签收、平台站内信等），并留存对方签收/拒收/退回证据。风险点包括：解除条件不成立、逾期行使解除权、通知送达瑕疵导致解除效力争议。',
    tags: ['合同', '解除权', '送达', '证据'],
    importance: Importance.HIGH,
    createdAt: daysAgo(2),
    linkedFilesCount: 6,
    wordCount: 680,
  },
  {
    id: '2',
    title: '劳动争议：仲裁举证清单与争点拆解模板',
    summary: '把争点拆成“事实—证据—法律依据—请求”，并准备一份可复用的证据目录与来源说明。',
    content:
      '常见争点：劳动关系、工资构成、加班、绩效、解除/辞退程序、经济补偿金。证据建议：劳动合同/入职登记/考勤、工资条与银行流水、绩效考核文件、解除通知、工牌/工作群聊天、邮件往来、社保记录等。办案方法：先用时间线锁定“何时发生了什么”，再用证据对照争点逐条覆盖。',
    tags: ['劳动仲裁', '加班', '工资', '解除'],
    importance: Importance.MEDIUM,
    createdAt: daysAgo(5),
    linkedFilesCount: 4,
    wordCount: 520,
  },
  {
    id: '3',
    title: '民间借贷：利息、逾期利息与证据链闭合',
    summary: '围绕“借款合意 + 交付 + 约定利息/还款 + 催收”构建证据链，避免只剩转账没有借条。',
    content:
      '关键证据：借条/借款合同、转账凭证、聊天记录/邮件确认、还款记录、催收通知与送达证明。风险点：资金往来性质不明（投资/代持/往来款）、利息约定不清或超过保护上限、共同借款/保证责任边界不清。',
    tags: ['民间借贷', '利息', '证据链'],
    importance: Importance.MEDIUM,
    createdAt: daysAgo(12),
    linkedFilesCount: 3,
    wordCount: 480,
  },
  {
    id: '4',
    title: '刑事辩护：首次会见要问的 10 个关键问题',
    summary: '会见目标：核对羁押信息、厘清事实与证据来源、识别程序瑕疵与非法证据风险。',
    content:
      '会见提纲：1) 指控罪名与侦查机关；2) 到案经过与讯问过程；3) 口供形成与是否有诱导/威胁；4) 同案人员关系；5) 物证/书证来源；6) 资金流/聊天记录/定位等电子证据；7) 是否申请取保候审的条件；8) 认罪认罚意向与量刑建议；9) 是否有从轻/减轻情节；10) 家属联系与退赃退赔安排。',
    tags: ['刑事辩护', '会见', '程序', '非法证据'],
    importance: Importance.HIGH,
    createdAt: daysAgo(15),
    linkedFilesCount: 7,
    wordCount: 720,
  },
  {
    id: '5',
    title: '诉讼时效：起算、中断、中止的实务判断',
    summary: '先确认“知道或应当知道”的起算点，再用催款、对账、诉讼/仲裁等事实判断是否发生中断。',
    content:
      '常见中断：催款函与对方回复/盖章对账单、分期还款承诺、支付部分款项、提起诉讼/仲裁、申请支付令等。注意：单方催款不当然中断，关键在于对方“认可债务”的证据。建议把时效节点做成表格：日期—事件—证据—是否中断/中止—备注。',
    tags: ['诉讼时效', '中断', '对账', '催款'],
    importance: Importance.HIGH,
    createdAt: daysAgo(20),
    linkedFilesCount: 5,
    wordCount: 640,
  },
  {
    id: '6',
    title: '公司法实务：股权转让的合规路径与文件清单',
    summary: '股权转让不只是签协议：还要走公司内部决议、工商变更与税务申报的全流程闭环。',
    content:
      '文件清单：股权转让协议、股东会决议/决定、章程修正案（如需）、放弃优先购买权声明、出资证明书、董事/法定代表人变更材料（如涉及）、税务申报资料、工商变更登记材料。风险点：瑕疵出资、隐名股东、对外担保与或有负债、对赌条款、竞业限制与保密。',
    tags: ['公司法', '股权转让', '尽调', '合规'],
    importance: Importance.MEDIUM,
    createdAt: daysAgo(22),
    linkedFilesCount: 5,
    wordCount: 690,
  },
  {
    id: '7',
    title: '庭审笔记模板：法官关注点/证据质证/法条要点',
    summary: '用结构化笔记提升庭审输出：争点—证据—质证意见—法条—合议风险。',
    content:
      '建议模板：1) 法庭调查：事实陈述与争点归纳；2) 举证质证：每组证据的真实性/关联性/合法性；3) 法庭辩论：核心法条与类案；4) 法官提问：对方漏洞与我方风险；5) 庭后补充：需补证事项与期限。配套：当庭记录同步标注证据页码与关键原话。',
    tags: ['庭审', '质证', '争点', '法条'],
    importance: Importance.MEDIUM,
    createdAt: daysAgo(45),
    linkedFilesCount: 2,
    wordCount: 560,
  },
  {
    id: '8',
    title: '律师函：结构、措辞与证据附件的最佳实践',
    summary: '律师函要“可被提交”：事实表述克制、诉求明确、证据附件清晰可核验。',
    content:
      '结构建议：背景事实（时间线）→ 权利基础（合同/法条）→ 具体诉求（金额/期限/方式）→ 后果告知（诉讼/仲裁/保全）→ 附件清单。常见坑：夸大事实、威胁性表述、附件缺失导致“只剩口头主张”。',
    tags: ['律师函', '送达', '措辞', '附件'],
    importance: Importance.LOW,
    createdAt: daysAgo(46),
    linkedFilesCount: 1,
    wordCount: 420,
  },
  {
    id: '9',
    title: '证据保全：诉前保全/行为保全的申请要点',
    summary: '先做可保全性与紧迫性论证，再准备担保方案，材料以“可审查、可执行”为准。',
    content:
      '材料建议：权利基础（合同/侵权）、紧迫性说明、标的物/行为可执行性、线索材料（账户、财产所在地、平台信息）、担保材料与金额建议。注意：申请时效、管辖、以及不当保全的责任风险。',
    tags: ['财产保全', '诉前', '担保', '紧迫性'],
    importance: Importance.HIGH,
    createdAt: daysAgo(60),
    linkedFilesCount: 4,
    wordCount: 610,
  },
  {
    id: '10',
    title: '电子证据：聊天记录与邮件的取证与固定',
    summary: '原则：来源可信、过程可复现、内容可校验；尽量通过公证/平台出具/可信时间戳固定。',
    content:
      '聊天记录取证：导出原始记录、保留账号主体信息、上下文完整、关键节点截图+录屏；邮件取证：保留完整邮件头、往来链条、附件原件与哈希校验（如有）。提示：单张截图证明力弱，需补充形成过程与来源说明。',
    tags: ['电子证据', '聊天记录', '邮件', '公证'],
    importance: Importance.MEDIUM,
    createdAt: daysAgo(100),
    linkedFilesCount: 3,
    wordCount: 520,
  },
  {
    id: '11',
    title: '法律检索：类案检索与裁判规则提炼方法',
    summary: '以争点为核心做关键词组合，筛选同案由/同要件/同裁判路径，最后提炼可引用的裁判规则。',
    content:
      '步骤：确定争点→拆解法律要件→构造检索式（案由+要件词+证据/情形）→筛选裁判层级与地域→提炼裁判规则→回填到代理意见。成果建议沉淀为“规则卡片”：规则表述、适用条件、反例、引用案例与链接。',
    tags: ['类案检索', '裁判规则', '争点', '代理意见'],
    importance: Importance.HIGH,
    createdAt: daysAgo(110),
    linkedFilesCount: 2,
    wordCount: 580,
  },
];

const getImportanceColor = (imp) => {
  switch (imp) {
    case Importance.HIGH:
      return 'bg-red-50 text-red-700 border-red-200';
    case Importance.MEDIUM:
      return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case Importance.LOW:
      return 'bg-blue-50 text-blue-700 border-blue-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
};

const StatCard = ({ label, value, icon, trend }) => {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">{icon}</div>
      <div>
        <div className="text-sm text-slate-500 font-medium">{label}</div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        {trend ? <div className="text-xs text-slate-400 mt-0.5">{trend}</div> : null}
      </div>
    </div>
  );
};

// Recharts-free bar chart (visual match to DESIGN-GUIDE; no new deps)
const TagDistributionChart = ({ snippets }) => {
  const data = useMemo(() => {
    const tagCounts = {};
    for (const s of snippets) {
      for (const t of s.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    return Object.entries(tagCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [snippets]);

  const max = Math.max(1, ...data.map((d) => d.count));
  const COLORS = ['bg-indigo-500', 'bg-indigo-400', 'bg-indigo-300', 'bg-indigo-200', 'bg-indigo-100', 'bg-slate-400', 'bg-slate-300', 'bg-slate-200'];

  return (
    <div className="w-full h-[300px] flex flex-col justify-center gap-3">
      {data.map((d, idx) => {
        const pct = Math.max(6, Math.round((d.count / max) * 100));
        return (
          <div key={d.name} className="flex items-center gap-3">
            <div className="w-24 text-xs text-slate-500 font-medium truncate">{d.name}</div>
            <div className="flex-1">
              <div className="h-5 bg-slate-100 rounded-md overflow-hidden border border-slate-200">
                <div
                  className={`h-5 ${COLORS[idx % COLORS.length]} rounded-md transition-[width] duration-500`}
                  style={{ width: `${pct}%` }}
                  title={`${d.name}: ${d.count}`}
                />
              </div>
            </div>
            <div className="w-8 text-right text-xs text-slate-400 font-mono">{d.count}</div>
          </div>
        );
      })}
      {!data.length ? <div className="text-sm text-slate-400">暂无数据</div> : null}
    </div>
  );
};

const ViewCard = ({ snippet, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer flex flex-col h-full"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex flex-wrap gap-1.5">
          {snippet.tags.slice(0, 3).map((t) => (
            <span key={t} className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-slate-100 text-slate-500 rounded-sm">
              {t}
            </span>
          ))}
          {snippet.tags.length > 3 ? (
            <span className="text-[10px] text-slate-400 px-1 py-0.5">+{snippet.tags.length - 3}</span>
          ) : null}
        </div>
        {snippet.importance === Importance.HIGH ? <Star size={14} className="text-amber-400 fill-amber-400" /> : null}
      </div>

      <h3 className="text-lg font-serif font-semibold text-slate-800 mb-2 group-hover:text-indigo-600 transition-colors">{snippet.title}</h3>

      <p className="text-sm text-slate-500 line-clamp-3 mb-4 flex-grow">{snippet.summary}</p>

      <div className="pt-4 border-t border-slate-50 flex items-center justify-between text-xs text-slate-400 mt-auto">
        <span>{new Date(snippet.createdAt).toLocaleDateString()}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500 font-medium">
          查看 <ChevronRight size={12} />
        </div>
      </div>
    </div>
  );
};

const TimelineView = ({ snippets, onSelect }) => {
  const sorted = useMemo(() => {
    return [...snippets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [snippets]);

  return (
    <div className="max-w-3xl mx-auto py-8 pl-4 relative">
      <div className="absolute left-8 top-0 bottom-0 w-px bg-slate-200" />
      {sorted.map((snippet) => (
        <div key={snippet.id} className="relative pl-16 mb-12 group">
          <div className="absolute left-[27px] top-6 w-3 h-3 rounded-full bg-white border-2 border-indigo-400 group-hover:bg-indigo-400 transition-colors z-10" />
          <div className="text-xs text-slate-400 mb-1 font-mono">
            {new Date(snippet.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <div
            onClick={() => onSelect(snippet)}
            className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md cursor-pointer transition-all relative"
          >
            <h3 className="font-semibold text-slate-800 text-lg mb-1 font-serif">{snippet.title}</h3>
            <p className="text-slate-500 text-sm mb-3">{snippet.summary}</p>
            <div className="flex gap-2 flex-wrap">
              {snippet.tags.map((t) => (
                <span key={t} className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const TopicsView = ({ snippets, onSelect }) => {
  const topics = useMemo(() => {
    const map = {};
    snippets.forEach((s) => {
      s.tags.forEach((t) => {
        if (!map[t]) map[t] = [];
        map[t].push(s);
      });
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [snippets]);

  return (
    <div className="space-y-10 py-6">
      {topics.map(([tagName, group]) => (
        <div key={tagName}>
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-xl font-bold text-slate-700">{tagName}</h3>
            <span className="text-xs font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{group.length} 条</span>
            <div className="h-px bg-slate-200 flex-grow" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {group.map((s) => (
              <ViewCard key={s.id} snippet={s} onClick={() => onSelect(s)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ImportanceView = ({ snippets, onSelect }) => {
  const grouped = useMemo(() => {
    return {
      [Importance.HIGH]: snippets.filter((s) => s.importance === Importance.HIGH),
      [Importance.MEDIUM]: snippets.filter((s) => s.importance === Importance.MEDIUM),
      [Importance.LOW]: snippets.filter((s) => s.importance === Importance.LOW),
    };
  }, [snippets]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 py-6 h-full">
      {['高', '中', '低'].map((level) => {
        const color =
          level === '高'
            ? 'text-red-600 border-red-200 bg-red-50'
            : level === '中'
              ? 'text-yellow-600 border-yellow-200 bg-yellow-50'
              : 'text-blue-600 border-blue-200 bg-blue-50';

        const enumKey = level === '高' ? Importance.HIGH : level === '中' ? Importance.MEDIUM : Importance.LOW;
        return (
          <div key={level} className="flex flex-col h-full bg-slate-50/50 rounded-xl p-4">
            <div className={`text-sm font-bold uppercase tracking-widest mb-6 pb-2 border-b-2 flex justify-between ${color}`}>
              <span className="px-2">{level} 优先级</span>
              <span className="px-2">{grouped[enumKey].length}</span>
            </div>
            <div className="space-y-4 overflow-y-auto pr-2 flex-grow">
              {grouped[enumKey].map((s) => (
                <div
                  key={s.id}
                  onClick={() => onSelect(s)}
                  className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 cursor-pointer hover:shadow-md hover:border-indigo-100 transition-all"
                >
                  <h4 className="font-medium text-slate-800 mb-1">{s.title}</h4>
                  <p className="text-xs text-slate-500 line-clamp-2">{s.summary}</p>
                </div>
              ))}
              {grouped[enumKey].length === 0 ? <div className="text-center text-slate-300 py-10 italic">暂无内容</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DashboardView = ({ snippets, onSelect }) => {
  return (
    <div className="space-y-8 py-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="知识卡片总数" value={snippets.length} icon={<BookOpen size={20} />} trend="本周 +3（示例）" />
        <StatCard label="文书/笔记规模" value="12.5k 字" icon={<List size={20} />} />
        <StatCard
          label="高优先级"
          value={snippets.filter((s) => s.importance === Importance.HIGH).length}
          icon={<Star size={20} />}
          trend="占比 25%"
        />
        <StatCard
          label="平均关联文件"
          value={(snippets.reduce((acc, s) => acc + s.linkedFilesCount, 0) / Math.max(1, snippets.length)).toFixed(1)}
          icon={<Layers size={20} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
            <BarChart2 size={18} className="text-indigo-500" />
            热门标签分布
          </h3>
          <TagDistributionChart snippets={snippets} />
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-indigo-500" />
            最近新增
          </h3>
          <div className="flex-grow space-y-4 overflow-y-auto pr-2 max-h-[300px]">
            {[...snippets]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 5)
              .map((s) => (
                <div
                  key={s.id}
                  onClick={() => onSelect(s)}
                  className="group cursor-pointer p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors"
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-slate-700 text-sm group-hover:text-indigo-600">{s.title}</span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">{new Date(s.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-1">{s.summary}</p>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-6 rounded-xl border border-indigo-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-indigo-900 flex items-center gap-2">
            <Star size={18} />
            今日重点复盘
          </h3>
          <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 uppercase tracking-wide">换一组</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{snippets.slice(0, 3).map((s) => <ViewCard key={s.id} snippet={s} onClick={() => onSelect(s)} />)}</div>
      </div>
    </div>
  );
};

const SnippetModal = ({ snippet, onClose }) => {
  if (!snippet) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getImportanceColor(snippet.importance)}`}>
                {snippet.importance} 优先级
              </span>
              <span className="text-slate-400 text-sm flex items-center gap-1">
                <Calendar size={14} />
                {new Date(snippet.createdAt).toLocaleDateString()}
              </span>
            </div>
            <h2 className="text-2xl font-serif font-semibold text-slate-800 leading-tight">{snippet.title}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 overflow-y-auto">
          <p className="text-lg text-slate-600 leading-relaxed font-serif mb-8 border-l-4 border-indigo-200 pl-4 italic bg-slate-50 py-2">
            "{snippet.summary}"
          </p>

          <div className="text-slate-700 leading-relaxed text-[15px]">
            <p>{snippet.content}</p>
          </div>

          <div className="mt-12 pt-6 border-t border-slate-100">
            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">上下文与元信息</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <span className="text-xs text-slate-400 block mb-2">关联标签</span>
                <div className="flex flex-wrap gap-2">
                  {snippet.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm">
                      <Tag size={12} />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs text-slate-400 block mb-2">系统关联</span>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1.5" title="关联文件">
                    <FileText size={16} className="text-indigo-400" />
                    {snippet.linkedFilesCount} 个关联文件
                  </span>
                  <span className="flex items-center gap-1.5" title="预计阅读时长">
                    <AlertCircle size={16} className="text-indigo-400" />
                    约 {~~(snippet.wordCount / 200)} 分钟
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs text-slate-400">
          <span>ID: {snippet.id}</span>
          <span className="italic">只读预览</span>
        </div>
      </div>
    </div>
  );
};

const KnowledgePanorama = () => {
  const [currentView, setCurrentView] = useState('overview');
  const [selectedSnippet, setSelectedSnippet] = useState(null);

  const viewOptions = useMemo(() => {
    return [
      { id: 'overview', label: '总览', icon: <Layout size={18} /> },
      { id: 'topics', label: '按主题', icon: <Tag size={18} /> },
      { id: 'timeline', label: '时间线', icon: <TrendingUp size={18} /> },
      { id: 'importance', label: '按优先级', icon: <Star size={18} /> },
    ];
  }, []);

  const renderContent = () => {
    switch (currentView) {
      case 'overview':
        return <DashboardView snippets={MOCK_SNIPPETS} onSelect={setSelectedSnippet} />;
      case 'timeline':
        return <TimelineView snippets={MOCK_SNIPPETS} onSelect={setSelectedSnippet} />;
      case 'topics':
        return <TopicsView snippets={MOCK_SNIPPETS} onSelect={setSelectedSnippet} />;
      case 'importance':
        return <ImportanceView snippets={MOCK_SNIPPETS} onSelect={setSelectedSnippet} />;
      default:
        return null;
    }
  };

  const getPageTitle = () => {
    switch (currentView) {
      case 'overview':
        return '知识库总览';
      case 'timeline':
        return '办案演进时间线';
      case 'topics':
        return '主题聚类';
      case 'importance':
        return '重点与优先级';
      default:
        return '知识库总览';
    }
  };

  const getPageSubtitle = () => {
    switch (currentView) {
      case 'overview':
        return '从全局视角查看你的办案知识资产（示例数据）。';
      case 'timeline':
        return '按时间回看知识沉淀与案件要点（示例数据）。';
      case 'topics':
        return '按主题聚合查看标签与卡片分布（示例数据）。';
      case 'importance':
        return '先处理最重要的事项与风险点（示例数据）。';
      default:
        return '';
    }
  };

  return (
    <div className="flex h-full w-full bg-slate-50 text-slate-800 overflow-hidden">
      {/* Inner left nav (mirrors DESIGN-GUIDE layout) */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 z-20">
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
            <BookOpen size={18} />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-800">KnowVault 知识库</span>
        </div>

        <div className="p-4 space-y-1">
          <p className="px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-4">视角</p>
          {viewOptions.map((view) => (
            <button
              key={view.id}
              onClick={() => setCurrentView(view.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                currentView === view.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {view.icon}
              {view.label}
            </button>
          ))}
        </div>

        <div className="mt-auto p-4 border-t border-slate-100">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <p className="text-xs text-slate-500 mb-2">知识健康度</p>
            <div className="w-full bg-slate-200 h-1.5 rounded-full mb-1">
              <div className="bg-emerald-400 h-1.5 rounded-full w-3/4" />
            </div>
            <p className="text-[10px] text-slate-400">75% 已标注且有关联（示例）</p>
          </div>
          <button className="w-full mt-4 flex items-center justify-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors p-2">
            <Filter size={14} /> 返回管理台（占位）
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-20 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between px-8 shrink-0">
          <div>
            <h1 className="text-2xl font-serif font-bold text-slate-800">{getPageTitle()}</h1>
            <p className="text-sm text-slate-500">{getPageSubtitle()}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="筛选当前视图（占位）"
                className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-64 transition-all"
              />
            </div>
            <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-full transition-colors">
              <Grid size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-8 pb-12 bg-slate-50/50">
          <div className="max-w-7xl mx-auto">{renderContent()}</div>
        </div>
      </main>

      <SnippetModal snippet={selectedSnippet} onClose={() => setSelectedSnippet(null)} />
    </div>
  );
};

export default KnowledgePanorama;


