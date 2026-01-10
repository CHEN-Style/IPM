import React from 'react';
import { Info, Clock, User, Hash, Tag, Download, Eye } from 'lucide-react';

const DetailPanel = ({ document }) => {
  if (!document) {
    return (
      <div className="w-80 bg-slate-50 h-full border-l border-slate-200 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center border border-slate-100 shadow-sm mb-4">
          <Info size={20} className="text-slate-300" />
        </div>
        <h4 className="text-sm font-medium text-slate-500">No Document Selected</h4>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">Select a file to view its metadata.</p>
      </div>
    );
  }

  return (
    <div className="w-80 bg-slate-50 h-full border-l border-slate-200 flex flex-col">
      <div className="p-6 border-b border-slate-200 bg-white">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Properties</h3>
        <div className="flex flex-col gap-4">
          <PropertyRow icon={<Hash size={14} />} label="ID" value={document.id} />
          <PropertyRow icon={<Clock size={14} />} label="Modified" value={document.lastModified} />
          <PropertyRow icon={<User size={14} />} label="Author" value={document.author} />
          <div className="flex flex-col gap-1.5 mt-2">
            <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
              <Tag size={10} /> Tags
            </span>
            <div className="flex flex-wrap gap-1">
              {document.tags.map((tag) => (
                <span key={tag} className="text-[11px] bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <section>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Summary</h3>
          <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.02)] min-h-[100px]">
            {document.summary ? (
              <p className="text-sm text-slate-600 leading-relaxed italic">"{document.summary}"</p>
            ) : (
              <p className="text-[11px] text-slate-400 leading-relaxed text-center py-4">No summary available.</p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">History</h3>
          <div className="space-y-3 pl-2 border-l border-slate-200 ml-1">
            <HistoryItem date="May 12, 14:20" user="John Doe" action="Document Updated" />
            <HistoryItem date="May 10, 09:15" user="System" action="Imported" />
            <HistoryItem date="May 08, 16:30" user="Alice Wang" action="Uploaded original" />
          </div>
        </section>
      </div>

      <div className="p-4 bg-white border-t border-slate-200 flex gap-2">
        <button className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded transition-colors flex items-center justify-center gap-2">
          <Eye size={14} /> Preview
        </button>
        <button className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded transition-colors flex items-center justify-center gap-2">
          <Download size={14} /> Download
        </button>
      </div>
    </div>
  );
};

const PropertyRow = ({ icon, label, value }) => (
  <div className="flex items-center justify-between text-xs">
    <div className="flex items-center gap-2 text-slate-400">
      {icon}
      <span>{label}</span>
    </div>
    <span className="font-medium text-slate-700">{value}</span>
  </div>
);

const HistoryItem = ({ date, user, action }) => (
  <div className="relative">
    <div className="absolute -left-[13px] top-1.5 w-2 h-2 rounded-full bg-slate-300 border border-white" />
    <div className="text-[10px] text-slate-400 font-medium">{date}</div>
    <div className="text-xs text-slate-700 font-medium mt-0.5">{action}</div>
    <div className="text-[10px] text-slate-400 italic">by {user}</div>
  </div>
);

export default DetailPanel;


