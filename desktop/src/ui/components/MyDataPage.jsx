import React, { useMemo } from 'react';
import {
  Briefcase, FolderKanban, GraduationCap, ChevronRight,
  Plus, Camera, BookOpen, Search, Upload, Sparkles,
  FolderOpen,
} from 'lucide-react';
import ProjectManager from './ProjectManager.jsx';

const ACCENT = '#3e4b9c';

/* ── Domain config ── */

const DOMAINS = [
  { key: 'cases', title: '案件', desc: '诉讼 / 仲裁 / 法律顾问', Icon: Briefcase },
  { key: 'projects', title: '项目', desc: '合规建设 / 知识迁移', Icon: FolderKanban },
  { key: 'study', title: '学习', desc: '法条解读 / 实务文章', Icon: GraduationCap },
];

/* ── Main page ── */

const MyDataPage = ({ section = 'home', onSectionChange, stats, onNavigate, searchNavTarget, onSearchNavDone }) => {
  const meta = useMemo(() => {
    if (section === 'cases') return { domain: 'cases' };
    if (section === 'projects') return { domain: 'projects' };
    if (section === 'study') return { domain: 'study' };
    return { domain: '' };
  }, [section]);

  if (section === 'projects' || section === 'cases') {
    return <ProjectManager domain={meta.domain} onBackHome={() => onSectionChange?.('home')} searchNavTarget={searchNavTarget} onSearchNavDone={onSearchNavDone} />;
  }
  if (section === 'study') {
    return <ProjectManager domain="study" onBackHome={() => onSectionChange?.('home')} searchNavTarget={searchNavTarget} onSearchNavDone={onSearchNavDone} />;
  }

  const totalItems = [stats?.cases?.count, stats?.projects?.count, stats?.study?.count]
    .filter((n) => typeof n === 'number').reduce((a, b) => a + b, 0);
  const totalActive = [stats?.cases?.active, stats?.projects?.active]
    .filter((n) => typeof n === 'number').reduce((a, b) => a + b, 0);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 12) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  })();

  const now = new Date();
  const weekdays = ['日','一','二','三','四','五','六'];
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 周${weekdays[now.getDay()]}`;

  return (
    <div className="flex-1 flex flex-col h-full" style={{ background: '#f8f9fb' }}>
      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-4 sm:px-6 xl:px-10 pt-4 pb-8 xl:pt-5 xl:pb-10">

          {/* ── Topbar ── */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-8">
            <div>
              <div className="flex items-baseline gap-2.5">
                <h1 className="text-xl font-bold tracking-tight" style={{ color: '#252a38', letterSpacing: '-0.02em' }}>{greeting}</h1>
                <span className="text-[12.5px]" style={{ color: '#9a9eb0' }}>{dateStr}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TopbarBtn icon={<Search size={14} />} label="搜索" />
              <TopbarBtn icon={<Plus size={14} />} label="新建案件" primary onClick={() => onSectionChange?.('cases')} />
            </div>
          </div>

          {/* ── Workspace cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {DOMAINS.map((d) => {
              const count = stats?.[d.key]?.count;
              const active = stats?.[d.key]?.active;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => onSectionChange?.(d.key)}
                  className="bg-white rounded-[10px] p-5 flex flex-col text-left relative group outline-none transition-all duration-200"
                  style={{ border: '1px solid #e2e4eb' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#d8dbed'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(62,75,156,0.06), 0 4px 12px rgba(62,75,156,0.04)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e4eb'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                  data-tour={`section-${d.key}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-8 h-8 rounded-[7px] flex items-center justify-center" style={{ background: '#f0f1f5' }}>
                      <d.Icon size={16} style={{ color: '#515668' }} />
                    </div>
                    {active > 0 ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: '#eceef7', color: ACCENT }}>
                        <span className="inline-block w-[5px] h-[5px] rounded-full mr-1 relative -top-px" style={{ background: ACCENT }} />
                        {active} 活跃
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: '#f0f1f5', color: '#9a9eb0' }}>空</span>
                    )}
                  </div>
                  <div className="text-[14.5px] font-semibold mb-0.5" style={{ color: '#2f3545', letterSpacing: '-0.01em' }}>{d.title}</div>
                  <div className="text-xs mb-4" style={{ color: '#9a9eb0' }}>{d.desc}</div>
                  <div className="mt-auto flex items-baseline gap-1">
                    <span className="text-[22px] font-bold" style={{ color: '#2f3545', letterSpacing: '-0.03em', lineHeight: 1 }}>{count ?? 0}</span>
                    <span className="text-xs" style={{ color: '#9a9eb0' }}>总计</span>
                  </div>
                  <div className="absolute bottom-5 right-5 transition-all" style={{ color: '#cdd0da' }}>
                    <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" style={{ color: 'inherit' }} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Activity + Data ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
            {/* Activity */}
            <Panel title="最近动态">
              {stats?.cases?.count > 0 && (
                <ActItem Icon={Briefcase} highlight text={<><strong>案件空间</strong> 包含 {stats.cases.count} 个项目，{stats.cases.active || 0} 个活跃</>} time="实时" />
              )}
              {stats?.projects?.count > 0 && (
                <ActItem Icon={FolderKanban} highlight text={<><strong>项目空间</strong> 包含 {stats.projects.count} 个项目，{stats.projects.active || 0} 个活跃</>} time="实时" />
              )}
              {stats?.study?.count > 0 && (
                <ActItem Icon={GraduationCap} text={<><strong>学习空间</strong> 已收录 {stats.study.count} 个主题</>} time="实时" />
              )}
              {!stats?.cases?.count && !stats?.projects?.count && !stats?.study?.count && (
                <div className="py-8 text-center">
                  <FolderOpen size={22} className="mx-auto mb-2" style={{ color: '#cdd0da' }} />
                  <p className="text-xs" style={{ color: '#9a9eb0' }}>暂无动态</p>
                </div>
              )}
            </Panel>

            {/* Data overview */}
            <Panel title="数据概览">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <DataCell value={totalItems || '—'} label="总文件" />
                <DataCell value={totalActive || '—'} label="活跃案件" />
                <DataCell value={stats?.study?.count ?? '—'} label="学习主题" />
                <DataCell value="—" label="本周新增" />
              </div>
              <MiniChart />
            </Panel>
          </div>

          {/* ── Quick actions + Summary ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Quick actions */}
            <Panel title="快捷操作">
              <div className="grid grid-cols-2 gap-1.5">
                <QABtn icon={<Plus size={14} />} label="新建案件" onClick={() => onSectionChange?.('cases')} />
                <QABtn icon={<FolderKanban size={14} />} label="新建项目" onClick={() => onSectionChange?.('projects')} />
                <QABtn icon={<Camera size={14} />} label="截图收集" onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/png,image/jpeg,image/jpg,image/webp';
                  input.onchange = async () => {
                    if (!input.files?.length) return;
                    try {
                      const buffer = new Uint8Array(await input.files[0].arrayBuffer());
                      await window.ipm?.knowledge?.createDraft?.({ type: 'screenshot', pngBuffer: buffer });
                    } catch { /* */ }
                  };
                  input.click();
                }} />
                <QABtn icon={<BookOpen size={14} />} label="知识库" onClick={() => onNavigate?.('knowledge')} />
                <QABtn icon={<Sparkles size={14} />} label="AI 分类" onClick={() => onSectionChange?.('cases')} />
                <QABtn icon={<Upload size={14} />} label="上传文件" onClick={() => onSectionChange?.('cases')} />
              </div>
            </Panel>

            {/* Summary */}
            <Panel title="本周摘要" className="flex flex-col justify-between">
              <div>
                <SummaryRow label="活跃案件" value={`${stats?.cases?.active ?? 0} 件`} />
                <SummaryRow label="活跃项目" value={`${stats?.projects?.active ?? 0} 个`} />
                <SummaryRow label="学习主题" value={`${stats?.study?.count ?? 0} 篇`} />
                <SummaryRow label="总规模" value={`${totalItems || 0} 条`} last />
              </div>
            </Panel>
          </div>

        </div>
      </div>
    </div>
  );
};

/* ── Sub-components ── */

const TopbarBtn = ({ icon, label, primary, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1.5 px-3.5 py-[7px] text-[12.5px] font-medium rounded-md transition-all cursor-pointer"
    style={{
      background: primary ? ACCENT : 'white',
      border: `1px solid ${primary ? ACCENT : '#e2e4eb'}`,
      color: primary ? 'white' : '#515668',
    }}
    onMouseEnter={(e) => {
      if (primary) { e.currentTarget.style.background = '#4e5bab'; e.currentTarget.style.borderColor = '#4e5bab'; }
      else { e.currentTarget.style.borderColor = '#cdd0da'; e.currentTarget.style.color = '#353a4d'; }
    }}
    onMouseLeave={(e) => {
      if (primary) { e.currentTarget.style.background = ACCENT; e.currentTarget.style.borderColor = ACCENT; }
      else { e.currentTarget.style.borderColor = '#e2e4eb'; e.currentTarget.style.color = '#515668'; }
    }}
  >
    {icon}{label}
  </button>
);

const Panel = ({ title, link, onLink, children, className = '' }) => (
  <div className={`bg-white rounded-[10px] p-5 ${className}`} style={{ border: '1px solid #e2e4eb' }}>
    <div className="flex items-center justify-between mb-4">
      <span className="text-xs font-semibold uppercase tracking-[0.04em]" style={{ color: '#9a9eb0' }}>{title}</span>
      {link && (
        <span className="text-xs font-medium cursor-pointer transition-colors" style={{ color: ACCENT }} onClick={onLink}>{link}</span>
      )}
    </div>
    {children}
  </div>
);

const ActItem = ({ Icon, highlight, text, time }) => (
  <div className="flex items-start gap-2.5 py-2.5" style={{ borderBottom: '1px solid #f0f1f5' }}>
    <div
      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-px"
      style={{ background: highlight ? '#eceef7' : '#f0f1f5' }}
    >
      <Icon size={13} style={{ color: highlight ? ACCENT : '#9a9eb0' }} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[12.5px] leading-relaxed" style={{ color: '#515668' }}>{text}</div>
      <div className="text-[11px] mt-0.5" style={{ color: '#9a9eb0' }}>{time}</div>
    </div>
  </div>
);

const DataCell = ({ value, label }) => (
  <div className="text-center py-2">
    <div className="text-xl font-bold" style={{ color: '#2f3545', letterSpacing: '-0.03em', lineHeight: 1.2 }}>{value}</div>
    <div className="text-[11px] mt-0.5" style={{ color: '#9a9eb0' }}>{label}</div>
  </div>
);

const MiniChart = () => {
  const bars = [35, 15, 60, 45, 20, 80, 100];
  return (
    <>
      <div className="flex items-end gap-1 h-12 pt-2">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-[3px] transition-all duration-500"
            style={{ height: `${h}%`, background: i % 2 === 1 ? '#e2e4eb' : ACCENT }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#6e7389' }}>
          <span className="w-[7px] h-[7px] rounded-sm" style={{ background: ACCENT }} /> 文件活动
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#6e7389' }}>
          <span className="w-[7px] h-[7px] rounded-sm" style={{ background: '#e2e4eb' }} /> 闲置
        </div>
      </div>
    </>
  );
};

const QABtn = ({ icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-2 px-3 py-2.5 rounded-md transition-all text-left"
    style={{ background: '#f8f9fb', border: '1px solid #f0f1f5' }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#d8dbed'; e.currentTarget.style.background = '#eceef7'; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#f0f1f5'; e.currentTarget.style.background = '#f8f9fb'; }}
  >
    <span style={{ color: '#9a9eb0' }}>{icon}</span>
    <span className="text-[12.5px] font-medium" style={{ color: '#515668' }}>{label}</span>
  </button>
);

const SummaryRow = ({ label, value, last }) => (
  <div className="flex justify-between py-1.5 text-[13px]" style={{ color: '#6e7389', borderBottom: last ? 'none' : '1px solid #f0f1f5' }}>
    <span>{label}</span>
    <strong className="font-semibold" style={{ color: '#353a4d' }}>{value}</strong>
  </div>
);

export default MyDataPage;
