import React, { useState, useEffect, useCallback, useRef } from 'react';

const ConversationNav = ({ userIndices, scrollContainerRef, messageRefs }) => {
  const [activeIdx, setActiveIdx] = useState(-1);
  const rafRef = useRef(null);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || userIndices.length < 2) return;

    const updateActive = () => {
      const rect = container.getBoundingClientRect();
      const centerY = rect.top + rect.height * 0.35;

      let closest = -1;
      let closestDist = Infinity;

      for (const idx of userIndices) {
        const el = messageRefs.current.get(idx);
        if (!el) continue;
        const elRect = el.getBoundingClientRect();
        const dist = Math.abs(elRect.top + elRect.height / 2 - centerY);
        if (dist < closestDist) {
          closestDist = dist;
          closest = idx;
        }
      }

      setActiveIdx(closest);
    };

    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateActive);
    };

    updateActive();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [userIndices, scrollContainerRef, messageRefs]);

  const scrollTo = useCallback(
    (idx) => {
      const el = messageRefs.current.get(idx);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [messageRefs],
  );

  if (userIndices.length < 2) return null;

  return (
    <div className="absolute right-2.5 top-0 bottom-0 z-10 flex items-center pointer-events-none">
      <div className="flex flex-col items-center pointer-events-auto py-8">
        {userIndices.map((idx, i) => {
          const isActive = idx === activeIdx;
          return (
            <React.Fragment key={idx}>
              {i > 0 && (
                <div className="w-px bg-gray-200/80" style={{ height: '18px' }} />
              )}
              <button
                type="button"
                onClick={() => scrollTo(idx)}
                className="group relative flex items-center justify-center"
                style={{ padding: '3px' }}
                title={`第 ${i + 1} 条提问`}
              >
                <span
                  className={`block rounded-full transition-all duration-200 ${
                    isActive
                      ? 'w-2 h-2 bg-gray-700 shadow-sm'
                      : 'w-[5px] h-[5px] bg-gray-300 group-hover:bg-gray-500'
                  }`}
                />
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default ConversationNav;
