import React from 'react';
import { ArrowLeft, Check, Ban, LayoutList, Folders, ListFilter, Plus } from 'lucide-react';

const HeaderBar = ({
  title,
  subtitle,
  showBackHome,
  onBackHome,
  showGoRoot,
  onGoRoot,
  viewMode,
  onSetViewMode,
  isRoot,
  showGoParent,
  onGoParent,
  onImportLocalFolder,
  pendingGhostCount,
  onAcceptAllGhostsHere,
  onRejectAllGhostsHere,
  onOpenNewFolder,
  onUploadFiles,
  onPickFilesAndAiClassify,
  aiUploadRunning,
  allowAiUpload,
  showCreateProject,
  newProjectName,
  onNewProjectNameChange,
  onCreateProject,
  newProjectInputRef,
  goRootLabel,
  createLabel,
}) => {
  return (
    <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
      <div className="min-w-0 flex items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight truncate">{title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>

        {showBackHome ? (
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            title="返回我的资料"
          >
            <ArrowLeft size={14} /> 返回我的资料
          </button>
        ) : null}

        {showGoRoot ? (
          <button
            type="button"
            onClick={onGoRoot}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={14} /> 返回{goRootLabel}
          </button>
        ) : null}

        {/* View Switcher (keep original header UI) */}
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => onSetViewMode?.('list')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            title="List View"
          >
            <LayoutList size={16} />
          </button>
          <button
            type="button"
            onClick={() => onSetViewMode?.('explorer')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'explorer' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            title="Explorer View"
          >
            <Folders size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {isRoot ? (
          <button
            type="button"
            onClick={onImportLocalFolder}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-200 transition-colors"
            title="导入一个本地文件夹（仅用于浏览/基础文件操作）"
          >
            导入本地
          </button>
        ) : null}

        {showGoParent ? (
          <button
            type="button"
            onClick={onGoParent}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-200 transition-colors"
          >
            上一级
          </button>
        ) : null}

        <div className="h-6 w-[1px] bg-slate-200"></div>

        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          title="暂未实现"
        >
          <ListFilter size={14} /> 筛选
        </button>

        {!isRoot ? (
          <div className="flex items-center gap-2">
            {pendingGhostCount ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onAcceptAllGhostsHere}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
                  title="接受本目录所有 AI 建议并移动"
                >
                  <span className="inline-flex items-center gap-2">
                    <Check size={14} /> 接受全部（{pendingGhostCount}）
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onRejectAllGhostsHere}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  title="放弃本目录所有 AI 建议"
                >
                  <span className="inline-flex items-center gap-2">
                    <Ban size={14} /> 放弃全部
                  </span>
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={onOpenNewFolder}
              className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              新建文件夹
            </button>
            <button
              type="button"
              onClick={onUploadFiles}
              className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
              disabled={aiUploadRunning}
            >
              上传文件
            </button>
            <button
              type="button"
              onClick={onPickFilesAndAiClassify}
              disabled={aiUploadRunning || !allowAiUpload}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-sm ${
                aiUploadRunning || !allowAiUpload ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
              title="选择一个或多个文件，逐个放入 temp，并逐个触发 AI 分类推荐"
            >
              {aiUploadRunning ? '上传并AI分类…' : '上传并AI分类'}
            </button>
          </div>
        ) : null}

        {showCreateProject ? (
          <div className="flex items-center gap-2">
            <input
              ref={newProjectInputRef}
              value={newProjectName}
              onChange={(e) => onNewProjectNameChange?.(e.target.value)}
              placeholder="输入项目名"
              className="px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-700 w-48 focus:outline-none focus:border-slate-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreateProject?.();
              }}
            />
            <button
              type="button"
              onClick={onCreateProject}
              className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm flex items-center gap-2"
            >
              <Plus size={14} /> 新建{createLabel}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};

export default HeaderBar;


