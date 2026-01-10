import React, { useEffect, useRef, useState } from 'react';

export const ConnectorLines = ({ viewMode, snippets, fileNodeRefs, snippetRefs, focusedNodeId, scrollVersion }) => {
  const [lines, setLines] = useState([]);
  const containerRef = useRef(null);

  useEffect(() => {
    if (viewMode !== 'association') {
      setLines([]);
      return;
    }

    const calculateLines = () => {
      const newLines = [];
      const svgRect = containerRef.current?.getBoundingClientRect();
      if (!svgRect) return;

      snippets.forEach((snippet) => {
        const linkedRelPath = snippet?.linkedTo?.relPath;
        if (!linkedRelPath) return;

        const fileEl = fileNodeRefs.current.get(linkedRelPath);
        const snippetEl = snippetRefs.current.get(snippet.id);
        if (!fileEl || !snippetEl) return;

        const fileRect = fileEl.getBoundingClientRect();
        const snippetRect = snippetEl.getBoundingClientRect();

        // Calculate start (Right of file node) and end (Left of snippet card)
        // Relative to the SVG container
        const startX = fileRect.right - svgRect.left - 5; // -5 to tuck into anchor
        const startY = fileRect.top + fileRect.height / 2 - svgRect.top;

        const endX = snippetRect.left - svgRect.left + 5; // +5 to tuck into anchor
        const endY = snippetRect.top + 24 - svgRect.top; // +24 approx vertically aligned with anchor

        // Bezier control points
        const dist = Math.abs(endX - startX);
        const cp1x = startX + dist * 0.5;
        const cp1y = startY;
        const cp2x = endX - dist * 0.5;
        const cp2y = endY;

        const pathData = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

        const isFocused = focusedNodeId === linkedRelPath;
        const isDimmed = focusedNodeId !== null && !isFocused;

        newLines.push({
          id: `${linkedRelPath}-${snippet.id}`,
          d: pathData,
          color: '#ef4444', // Red 500
          opacity: isDimmed ? 0.05 : focusedNodeId ? 1 : 0.4,
          width: isFocused ? 3 : 1.5,
        });
      });
      setLines(newLines);
    };

    // Calculate immediately
    calculateLines();

    // Calculate on next animation frame to ensure layout is settled
    const raf = requestAnimationFrame(calculateLines);
    return () => cancelAnimationFrame(raf);
  }, [viewMode, snippets, focusedNodeId, scrollVersion, fileNodeRefs, snippetRefs]);

  if (viewMode !== 'association') return null;

  return (
    <svg ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible">
      <defs>
        <marker id="dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4">
          <circle cx="5" cy="5" r="5" fill="#ef4444" />
        </marker>
      </defs>
      {lines.map((line) => (
        <path
          key={line.id}
          d={line.d}
          stroke={line.color}
          strokeWidth={line.width}
          strokeOpacity={line.opacity}
          fill="none"
          strokeLinecap="round"
          className="transition-all duration-300 ease-out"
        />
      ))}
    </svg>
  );
};


