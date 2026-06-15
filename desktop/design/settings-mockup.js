/* 设计稿交互:hash 路由 + 视图渲染。仅为视觉确认用,无真实数据。 */

const ICONS = {
  general: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3 3 3 0 0 0 0 6 3 3 0 0 0 3 3v1a3 3 0 0 0 6 0v-1a3 3 0 0 0 3-3 3 3 0 0 0 0-6 3 3 0 0 0-3-3V5a3 3 0 0 0-3-3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  org: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
};

/* ───────── 设置:通用 ───────── */
function viewGeneral() {
  return `
  <div class="sec-title">通用</div>
  <div class="sec-desc">本地优先 · 所有偏好保存在本机 userfile。</div>

  <div class="panel">
    <div class="panel-head"><div><div class="pt">${ICONS.general}数据存储位置</div><div class="pd">项目文件、案件资料、数据库均存储在此目录下。</div></div></div>
    <div class="panel-body">
      <div class="field">
        <label class="field-label">当前路径</label>
        <div class="input-row">
          <span class="path-box">D:\\IPM-Data\\userfile</span>
          <button class="btn">更改…</button>
          <button class="btn ghost" title="恢复默认">重置</button>
        </div>
      </div>
      <div class="hint">更改后,已有数据会自动复制到新目录,需重启应用生效。</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><div><div class="pt">悬浮窗上传文件模式</div><div class="pd">决定悬浮窗里拖拽 / 选择文件后的行为。</div></div></div>
    <div class="panel-body">
      <div class="radio-grid">
        <div class="radio-pill on"><div class="rl">先斩后奏模式</div><div class="rh">拖拽 / 选择文件后立即上传到当前项目 temp/,并提供 3 秒撤销。</div></div>
        <div class="radio-pill"><div class="rl">手动确认模式</div><div class="rh">拖拽 / 选择后需点击「确认并保存」,行为与当前一致。</div></div>
      </div>
    </div>
  </div>`;
}

/* ───────── 设置:AI 模型 ───────── */
function viewAi() {
  return `
  <div class="sec-title">AI 模型</div>
  <div class="sec-desc">管理多个 AI Provider,并把不同模型分配给 KnowClaw、文件分类等功能。</div>

  <div class="statbar">
    <div class="st"><div class="k">Providers</div><div class="v">3</div></div>
    <div class="st"><div class="k">KnowClaw 模型</div><div class="v">2</div></div>
    <div class="st"><div class="k">状态</div><div class="v warn">有未保存修改</div></div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div><div class="pt">${ICONS.server}1 · API 接入点</div><div class="pd">OpenAI、Claude、Gemini 或任意 OpenAI 兼容中转站。先查询模型,再在下方分配用途。</div></div>
      <button class="btn sm">+ 新增 Provider</button>
    </div>
    <div class="panel-body">
      <div class="prov">
        <div class="prov-head" onclick="this.parentNode.querySelector('.prov-body').classList.toggle('hide')">
          <div class="prov-ic">${ICONS.server}</div>
          <div class="prov-meta"><div class="n">OpenAI 官方</div><div class="s">OpenAI 官方 · https://api.openai.com/v1</div></div>
          <div class="prov-tags"><span class="tag ok">Key 已配置</span><span class="tag">18 个模型</span></div>
        </div>
        <div class="prov-body">
          <div class="grid2" style="margin-bottom:12px">
            <div class="field" style="margin:0"><label class="field-label">显示名称</label><input class="input" value="OpenAI 官方"></div>
            <div class="field" style="margin:0"><label class="field-label">类型</label><input class="input" value="OpenAI 官方" readonly></div>
          </div>
          <div class="field"><label class="field-label">API Base URL</label><input class="input mono" value="https://api.openai.com/v1"></div>
          <div class="field"><label class="field-label">API Key</label><div class="with-eye"><input class="input mono" type="password" value="sk-xxxxxxxxxxxxxxxx"><span class="eye">${ICONS.eye}</span></div></div>
          <div class="field" style="margin:0">
            <label class="field-label">OpenAI 协议端点</label>
            <input class="input" value="/responses(推荐,支持推理模型思考流)" readonly>
          </div>
          <div style="display:flex;gap:8px;margin-top:13px;align-items:center">
            <button class="btn dark sm">查询可用模型</button>
            <span class="hint" style="margin:0">上次查询:今天 10:24(18 个)</span>
          </div>
        </div>
      </div>

      <div class="prov">
        <div class="prov-head">
          <div class="prov-ic">${ICONS.server}</div>
          <div class="prov-meta"><div class="n">CloseAI 中转</div><div class="s">OpenAI 兼容 · https://api.closeai.com/v1</div></div>
          <div class="prov-tags"><span class="tag ok">Key 已配置</span><span class="tag">42 个模型</span></div>
        </div>
      </div>

      <div class="prov">
        <div class="prov-head">
          <div class="prov-ic">${ICONS.server}</div>
          <div class="prov-meta"><div class="n">Claude 官方</div><div class="s">Anthropic · https://api.anthropic.com</div></div>
          <div class="prov-tags"><span class="tag warn">仅非 KnowClaw 角色</span><span class="tag ok">Key 已配置</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><div><div class="pt">${ICONS.route}2 · 模型路由</div><div class="pd">为每个 AI 功能选择最适合的模型。KnowClaw 支持多个模型,其它功能使用一个固定模型。</div></div></div>
    <div class="panel-body">
      <div class="role-block kc">
        <div class="role-head"><div><div class="rn">KnowClaw 对话</div><div class="rd">可配置多个模型,运行时可切换。</div></div><span class="tag">2 个模型</span></div>
        <div class="kc-models">
          <div class="model-pill"><div class="mi">${ICONS.spark}</div><div class="mm"><div class="mn">gpt-4o</div><div class="mp">OpenAI 官方 · /r</div></div><span class="x">${ICONS.x}</span></div>
          <div class="model-pill"><div class="mi">${ICONS.spark}</div><div class="mm"><div class="mn">claude-3.5-sonnet</div><div class="mp">CloseAI 中转 · /c</div></div><span class="x">${ICONS.x}</span></div>
        </div>
        <div class="selectish"><span class="sv ph">搜索并选择一个 KnowClaw 模型…</span><button class="btn dark sm">+ 添加</button></div>
      </div>

      <div class="role-grid3">
        <div class="role-block">
          <div class="role-head" style="display:block"><div class="rn">文件分类</div><div class="rd">驱动文件入库自动分类。</div></div>
          <div class="selectish"><div class="sv"><div class="top">OpenAI 官方</div><div class="mid">gpt-4o-mini <span class="mode-chip">/r</span></div></div></div>
        </div>
        <div class="role-block">
          <div class="role-head" style="display:block"><div class="rn">网页摘要 / 总结</div><div class="rd">剪藏与碎片自动总结。</div></div>
          <div class="selectish"><div class="sv"><div class="top">CloseAI 中转</div><div class="mid">claude-3-haiku <span class="mode-chip">/c</span></div></div></div>
        </div>
        <div class="role-block">
          <div class="role-head" style="display:block"><div class="rn">偏好解析</div><div class="rd">口语描述转分类规则。</div></div>
          <div class="selectish"><span class="sv ph">未选择,自动回退</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="save-bar">
    <button class="btn dark">保存配置</button>
    <span class="msg">有未保存的修改 · 当前配置已保存到本地</span>
  </div>
  <div class="hint">• OpenAI 兼容 / OpenAI 官方 可用于全部角色。Claude / Gemini 暂不支持作为 KnowClaw 直连后端,可走兼容网关。</div>`;
}

/* ───────── 设置:网页搜索 ───────── */
function viewSearch() {
  return `
  <div class="sec-title">网页搜索 API</div>
  <div class="sec-desc">配置博查 (Bocha) 搜索 API Key,为 KnowClaw 提供联网搜索能力。</div>

  <div class="panel">
    <div class="panel-head"><div><div class="pt">${ICONS.search}博查 Bocha</div><div class="pd">新用户注册可免费获得 1000 次搜索调用额度。</div></div></div>
    <div class="panel-body">
      <div class="field"><label class="field-label">API Key</label><div class="with-eye"><input class="input mono" type="password" value="sk-bocha-xxxxxxxx"><span class="eye">${ICONS.eye}</span></div></div>
      <div style="display:flex;gap:8px"><button class="btn dark">保存</button><button class="btn">测试连接</button></div>
      <div class="note-box warn" style="margin-top:14px">未配置搜索 API Key 时,KnowClaw 仍可抓取你指定的 URL,但无法主动联网搜索。</div>
      <div class="hint">前往 <a href="#">博查 AI 开放平台 ↗</a> 注册账号获取 Key。配置变更将在下次新建 / 打开 KnowClaw 会话时生效。</div>
    </div>
  </div>`;
}

/* ───────── 设置:企业配置(仅成员导入) ───────── */
function viewOrg() {
  return `
  <div class="sec-title">企业配置</div>
  <div class="sec-desc">输入管理员发放的配置码,一键导入企业统一的 AI Provider、模型路由与搜索 API。</div>

  <div class="panel">
    <div class="panel-head"><div><div class="pt">${ICONS.org}导入企业 AI 配置</div><div class="pd">配置由企业管理员在「企业管理 › 配置中心」中创建与分发。</div></div></div>
    <div class="panel-body">
      <div class="field">
        <label class="field-label">配置码</label>
        <div class="input-row"><input class="input mono" style="text-transform:uppercase" value="IPM-AI-7K2M-9QXR"><button class="btn">预览</button></div>
      </div>

      <div style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-top:6px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div><div style="font-size:13px;font-weight:600">公司统一 AI 配置</div><div style="font-size:12px;color:var(--text-3);margin-top:3px">恒瑞所内统一的 GPT-4o + 中转网关配置</div></div>
          <span class="chip">已用 12 / 50</span>
        </div>
        <div class="summary-grid" style="margin-top:12px">
          <div class="sg">2 个 Provider:OpenAI 官方、CloseAI 中转</div>
          <div class="sg">KnowClaw 2 个 / 分类 / 摘要</div>
          <div class="sg">包含搜索 API</div>
          <div class="sg warn">包含 API Key 等敏感凭证</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;font-size:11.5px;color:var(--text-4)">
          <span>创建人:王律师(管理员)</span><span>过期:2026-12-31</span>
        </div>
      </div>

      <div class="note-box danger" style="margin-top:14px">
        <b>覆盖提示:</b>导入会<b>覆盖</b>本机现有的 AI Provider、模型角色分配和搜索 API 设置。企业模板可能包含 API Key,这些凭证将保存到当前电脑的本地设置中。
      </div>

      <div style="margin-top:14px"><button class="btn dark">确认覆盖导入</button></div>
    </div>
  </div>`;
}

const SETTINGS_SECTIONS = [
  { key: 'general', label: '通用', icon: ICONS.general, render: viewGeneral },
  { key: 'ai', label: 'AI 模型', icon: ICONS.ai, render: viewAi },
  { key: 'search', label: '网页搜索', icon: ICONS.search, render: viewSearch },
  { key: 'org', label: '企业配置', icon: ICONS.org, render: viewOrg },
];

function renderSettings(section) {
  const navItems = SETTINGS_SECTIONS.map((s) =>
    `<a class="snav-item ${s.key === section ? 'active' : ''}" href="#settings-${s.key}">${s.icon}${s.label}</a>`
  ).join('');
  const current = SETTINGS_SECTIONS.find((s) => s.key === section) || SETTINGS_SECTIONS[0];
  return `
  <div class="topbar"><div class="crumb">设置</div><div class="actions"></div></div>
  <div class="settings-body">
    <nav class="settings-nav">
      <div class="grp">偏好</div>
      ${navItems}
    </nav>
    <div class="settings-content"><div class="inner">${current.render()}</div></div>
  </div>`;
}

/* ───────── 控制台:配置中心 ───────── */
function renderConsoleConfig() {
  return `
  <div class="topbar">
    <div class="crumb"><span class="link" onclick="toast('返回企业管理')">企业管理</span><span class="sep">›</span>配置中心</div>
    <div class="actions"><button class="btn dark" onclick="openModal('modal-create')">+ 从本机配置创建模板</button></div>
  </div>

  <div class="tab-nav">
    <div class="tab">成员 <span class="n">24</span></div>
    <div class="tab">云端项目 <span class="n">8</span></div>
    <div class="tab">技能治理</div>
    <div class="tab on">配置中心 <span class="n">3</span></div>
    <div class="tab">概览与审计 <span class="pl">规划中</span></div>
  </div>

  <div class="console-stat">
    <div class="cs"><div class="k">AI 配置模板</div><div class="v">3 <small>· 2 启用</small></div></div>
    <div class="cs"><div class="k">累计导入</div><div class="v">37 <small>次</small></div></div>
    <div class="cs"><div class="k">活跃配置码</div><div class="v">2</div></div>
    <div class="cs"><div class="k">本月新导入</div><div class="v">9</div></div>
  </div>

  <div class="filterbar">
    <div class="pills">
      <span class="pill on">AI 配置 <span class="n">3</span></span>
      <span class="pill planned">MCP 配置 <span class="pl">规划中</span></span>
    </div>
    <div class="right"><div class="search-mini">${ICONS.search}<input placeholder="搜索模板…"></div></div>
  </div>

  <div class="colhead">
    <span class="c-tpl">模板</span>
    <span class="c-st">状态</span>
    <span class="c-code2">配置码</span>
    <span class="c-usage2">使用</span>
    <span class="c-exp2">过期</span>
    <span class="c-by2">创建人</span>
    <span class="c-act"></span>
  </div>

  <div style="flex:1;overflow-y:auto">
    <div class="row" onclick="openDrawer()">
      <div class="c-tpl"><div class="tn">公司统一 AI 配置</div><div class="td">恒瑞所内统一的 GPT-4o + 中转网关配置</div></div>
      <span class="c-st"><span class="health ok"><span class="dot"></span>启用</span></span>
      <span class="c-code2"><span class="code">IPM-AI-7K2M-9QXR</span></span>
      <span class="c-usage2">12 / 50<div class="usage-bar"><i style="width:24%"></i></div></span>
      <span class="c-exp2">2026-12-31</span>
      <span class="c-by2">王律师</span>
      <span class="c-act hov"><button class="icon-btn" onclick="event.stopPropagation();openDrawer()">${ICONS.dots}</button></span>
    </div>
    <div class="row" onclick="openDrawer()">
      <div class="c-tpl"><div class="tn">实习生只读配置</div><div class="td">仅含摘要 / 分类模型,不含 KnowClaw 对话</div></div>
      <span class="c-st"><span class="health ok"><span class="dot"></span>启用</span></span>
      <span class="c-code2"><span class="code">IPM-AI-3FWN-D8HT</span></span>
      <span class="c-usage2">25 / 不限<div class="usage-bar"><i style="width:50%;background:var(--text-3)"></i></div></span>
      <span class="c-exp2">不过期</span>
      <span class="c-by2">李文博</span>
      <span class="c-act hov"><button class="icon-btn" onclick="event.stopPropagation();openDrawer()">${ICONS.dots}</button></span>
    </div>
    <div class="row" style="opacity:0.6" onclick="openDrawer()">
      <div class="c-tpl"><div class="tn">2025 旧网关配置</div><div class="td">已停用 · 旧中转站迁移前的配置</div></div>
      <span class="c-st"><span class="health off"><span class="dot"></span>已停用</span></span>
      <span class="c-code2"><span class="code" style="text-decoration:line-through;color:var(--text-4)">IPM-AI-VV4C-K2LP</span></span>
      <span class="c-usage2">0 / 10</span>
      <span class="c-exp2">—</span>
      <span class="c-by2">王律师</span>
      <span class="c-act hov"><button class="icon-btn" onclick="event.stopPropagation();openDrawer()">${ICONS.dots}</button></span>
    </div>
  </div>

  ${drawerHtml()}
  ${createModalHtml()}`;
}

function drawerHtml() {
  return `
  <div class="drawer-mask" id="drawer-mask" onclick="closeDrawer()"></div>
  <aside class="drawer" id="drawer">
    <div class="drawer-head">
      <div class="dt">公司统一 AI 配置 <span class="chip active">启用</span></div>
      <div class="dd">恒瑞所内统一的 GPT-4o + 中转网关配置</div>
    </div>
    <div class="drawer-body">
      <div class="d-sec">
        <div class="l">配置码</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="code" style="font-size:14px">IPM-AI-7K2M-9QXR</span>
          <button class="icon-btn" onclick="toast('已复制配置码')">${ICONS.copy}</button>
        </div>
      </div>
      <div class="d-sec">
        <div class="l">属性</div>
        <div class="prop"><span class="k">使用次数</span><span class="v">12 / 50</span></div>
        <div class="prop"><span class="k">过期时间</span><span class="v">2026-12-31</span></div>
        <div class="prop"><span class="k">创建人</span><span class="v">王律师</span></div>
        <div class="prop"><span class="k">创建于</span><span class="v">2026-05-01</span></div>
        <div class="prop"><span class="k">凭证</span><span class="v" style="color:var(--amber)">已加密存储 · AES-256-GCM</span></div>
      </div>
      <div class="d-sec">
        <div class="l">配置摘要</div>
        <div class="summary-grid">
          <div class="sg">2 个 Provider:OpenAI 官方、CloseAI 中转</div>
          <div class="sg">KnowClaw 2 个 / 分类 / 摘要</div>
          <div class="sg">包含搜索 API</div>
          <div class="sg warn">包含 API Key 等敏感凭证</div>
        </div>
      </div>
      <div class="d-sec">
        <div class="l">导入记录 · 12 次</div>
        <div class="use-line"><span class="who">陈思琪</span><span class="when">2 小时前</span></div>
        <div class="use-line"><span class="who">孙雨晴</span><span class="when">昨天 14:30</span></div>
        <div class="use-line"><span class="who">李文博</span><span class="when">2026-06-08</span></div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn">编辑元数据…</button>
      <button class="btn">刷新配置码</button>
      <button class="btn danger" onclick="openModal('modal-disable')">停用</button>
    </div>
  </aside>`;
}

function createModalHtml() {
  return `
  <div class="overlay" id="modal-create">
    <div class="modal">
      <div class="m-head"><h3>从本机配置创建模板</h3><p>将你当前电脑的 AI Provider、模型路由与搜索 API 打包为企业模板</p></div>
      <div class="m-body">
        <div class="field"><label class="field-label">模板名称</label><input class="input" placeholder="例如 公司统一 AI 配置"></div>
        <div style="display:flex;gap:10px">
          <div class="field" style="flex:1"><label class="field-label">最大使用次数</label><input class="input" placeholder="留空不限"></div>
          <div class="field" style="flex:1"><label class="field-label">过期时间</label><input class="input" type="date"></div>
        </div>
        <div class="field"><label class="field-label">描述(给成员看)</label><input class="input" placeholder="可选"></div>
        <div class="note-box danger">本机当前包含 <b>3 个 Provider</b>(其中 3 个含 API Key)与搜索 API Key。这些<b>敏感凭证将随模板加密存储于服务器</b>,凭配置码导入的成员会在其本地获得完整凭证。请仅发给受信任成员。</div>
      </div>
      <div class="m-foot">
        <button class="btn" onclick="closeModal('modal-create')">取消</button>
        <button class="btn dark" onclick="closeModal('modal-create');toast('模板已创建 · 配置码 IPM-AI-9XK2-MQ4R')">创建并生成配置码</button>
      </div>
    </div>
  </div>

  <div class="overlay" id="modal-disable">
    <div class="modal">
      <div class="m-head"><h3>停用「公司统一 AI 配置」?</h3><p>已用 12 / 50 次</p></div>
      <div class="m-body"><div class="note-box warn">停用后该配置码<b>立即失效</b>,无法再预览或导入。已导入的成员本地配置不受影响。可随时重新启用。</div></div>
      <div class="m-foot">
        <button class="btn" onclick="closeModal('modal-disable')">取消</button>
        <button class="btn danger" onclick="closeModal('modal-disable');toast('模板已停用')">确认停用</button>
      </div>
    </div>
  </div>`;
}

/* ───────── 路由 ───────── */
function route() {
  const hash = (location.hash || '#settings-ai').slice(1);
  const main = document.getElementById('main');
  const enterpriseNav = document.getElementById('snav-enterprise');
  const settingsNav = document.getElementById('snav-settings');

  if (hash.startsWith('settings-')) {
    const section = hash.replace('settings-', '');
    main.innerHTML = renderSettings(section);
    settingsNav.classList.add('active');
    enterpriseNav.classList.remove('active');
  } else if (hash.startsWith('console-config')) {
    main.innerHTML = renderConsoleConfig();
    enterpriseNav.classList.add('active');
    settingsNav.classList.remove('active');
    if (hash === 'console-config-drawer') setTimeout(openDrawer, 50);
    if (hash === 'console-config-create') setTimeout(() => openModal('modal-create'), 50);
  } else {
    main.innerHTML = renderSettings('ai');
  }

  document.querySelectorAll('.viewswitch a').forEach((a) => {
    a.classList.toggle('on', a.getAttribute('href') === '#' + hash);
  });
}

function openDrawer() { document.getElementById('drawer-mask').classList.add('open'); document.getElementById('drawer').classList.add('open'); }
function closeDrawer() { document.getElementById('drawer-mask').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
route();
