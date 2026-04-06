import React, { useEffect, useState } from 'react';
import { Users, Cloud, MessageSquare, GitBranch, Sparkles } from 'lucide-react';

const ICONS = [Users, Cloud, MessageSquare, GitBranch];

const OverviewPage = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 2500);
    return () => clearInterval(t);
  }, []);

  const CurIcon = ICONS[tick % ICONS.length];

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-slate-50">
      <div
        style={{
          width: 420,
          height: 320,
          borderRadius: 18,
          position: 'relative',
          overflow: 'hidden',
          background: 'repeating-linear-gradient(45deg, #F8F9FC, #F8F9FC 14px, #F0F2F8 14px, #F0F2F8 28px)',
          border: '1.5px dashed rgba(99,102,241,0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        {/* Subtle diagonal stripes overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.025,
            backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 24px, #6366f1 24px, #6366f1 26px)',
          }}
        />

        {/* Rotating icon */}
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            background: 'rgba(99,102,241,0.06)',
            border: '1px solid rgba(99,102,241,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transform: `rotate(${tick % 2 === 0 ? -6 : 6}deg)`,
          }}
        >
          <CurIcon size={26} style={{ color: 'rgba(99,102,241,0.5)', transition: 'all 0.4s ease' }} />
        </div>

        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#6366f1',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center',
            }}
          >
            <Sparkles size={13} style={{ color: 'rgba(99,102,241,0.45)' }} />
            协作中心 · 开发中
            <Sparkles size={13} style={{ color: 'rgba(99,102,241,0.45)' }} />
          </div>
          <div style={{ fontSize: 11, color: '#94A3B1', lineHeight: 1.8 }}>
            多人协作 · 任务管理
            <br />
            云端同步 · 团队通知
          </div>
        </div>

        {/* Decorative corners */}
        <div style={{ position: 'absolute', top: 12, left: 12, width: 18, height: 18, borderTop: '2px solid rgba(99,102,241,0.2)', borderLeft: '2px solid rgba(99,102,241,0.2)', borderRadius: '3px 0 0 0' }} />
        <div style={{ position: 'absolute', top: 12, right: 12, width: 18, height: 18, borderTop: '2px solid rgba(99,102,241,0.2)', borderRight: '2px solid rgba(99,102,241,0.2)', borderRadius: '0 3px 0 0' }} />
        <div style={{ position: 'absolute', bottom: 12, left: 12, width: 18, height: 18, borderBottom: '2px solid rgba(99,102,241,0.2)', borderLeft: '2px solid rgba(99,102,241,0.2)', borderRadius: '0 0 0 3px' }} />
        <div style={{ position: 'absolute', bottom: 12, right: 12, width: 18, height: 18, borderBottom: '2px solid rgba(99,102,241,0.2)', borderRight: '2px solid rgba(99,102,241,0.2)', borderRadius: '0 0 3px 0' }} />
      </div>
    </div>
  );
};

export default OverviewPage;
