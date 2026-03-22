import React from 'react';
import { ArrowRight, CheckCircle2, Clock, Loader2 } from 'lucide-react';

const ClassifyPipeline = ({ queued, classifying, pendingGhostCount }) => {
  const queuedCount = queued?.length || 0;
  const classifyingCount = classifying?.length || 0;
  const isProcessing = queuedCount > 0 || classifyingCount > 0;

  return (
    <div className={`flex items-center gap-1.5 transition-opacity duration-500 ${isProcessing ? 'opacity-100' : 'opacity-40'}`}>
      {/* Queued */}
      <div className="flex items-center gap-1" title={isProcessing ? `${queuedCount} 个文件等待分类` : '无文件等待分类'}>
        <Clock size={12} className={isProcessing && queuedCount > 0 ? 'text-slate-500' : 'text-slate-300'} />
        <span className={`text-[11px] font-semibold tabular-nums ${isProcessing && queuedCount > 0 ? 'text-slate-600' : 'text-slate-300'}`}>
          {queuedCount}
        </span>
      </div>

      <ArrowRight size={10} className={isProcessing ? 'text-slate-400' : 'text-slate-200'} />

      {/* Classifying */}
      <div className="flex items-center gap-1" title={isProcessing ? `${classifyingCount} 个文件正在分类` : '无文件正在分类'}>
        <Loader2
          size={12}
          className={`${classifyingCount > 0 ? 'text-blue-500 animate-spin' : isProcessing ? 'text-blue-300' : 'text-slate-300'}`}
        />
        <span className={`text-[11px] font-semibold tabular-nums ${classifyingCount > 0 ? 'text-blue-600' : isProcessing ? 'text-blue-300' : 'text-slate-300'}`}>
          {classifyingCount}
        </span>
      </div>

      <ArrowRight size={10} className={isProcessing ? 'text-slate-400' : 'text-slate-200'} />

      {/* Classified (= pending ghost count) */}
      <div className="flex items-center gap-1" title={`${pendingGhostCount} 个已分类待处理`}>
        <CheckCircle2 size={12} className={pendingGhostCount > 0 ? 'text-emerald-500' : isProcessing ? 'text-emerald-300' : 'text-slate-300'} />
        <span className={`text-[11px] font-semibold tabular-nums ${pendingGhostCount > 0 ? 'text-emerald-600' : isProcessing ? 'text-emerald-300' : 'text-slate-300'}`}>
          {pendingGhostCount}
        </span>
      </div>
    </div>
  );
};

export default ClassifyPipeline;
