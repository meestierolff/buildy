import { useRef, useState, useCallback } from "react";

interface Props {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
}

const BeforeAfterSlider = ({ beforeUrl, afterUrl, className = "" }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  }, []);

  return (
    <div
      ref={ref}
      className={`relative w-full aspect-[4/3] overflow-hidden rounded-lg bg-muted select-none touch-none ${className}`}
      onMouseDown={(e) => { dragging.current = true; updateFromClientX(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updateFromClientX(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => { dragging.current = true; updateFromClientX(e.touches[0].clientX); }}
      onTouchMove={(e) => { if (dragging.current) updateFromClientX(e.touches[0].clientX); }}
      onTouchEnd={() => { dragging.current = false; }}
    >
      <img src={afterUrl} alt="Na" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
      <div
        className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
        style={{ width: `${pos}%` }}
      >
        <img
          src={beforeUrl}
          alt="Voor"
          className="absolute inset-0 h-full object-cover"
          style={{ width: ref.current?.offsetWidth || "100%" }}
        />
      </div>
      {/* Labels — bottom corners to avoid overlap with card header actions */}
      <span className="absolute bottom-2 left-2 text-[10px] font-bold uppercase tracking-widest bg-black/65 text-white px-2 py-0.5 rounded-full">Voor</span>
      <span className="absolute bottom-2 right-2 text-[10px] font-bold uppercase tracking-widest bg-black/65 text-white px-2 py-0.5 rounded-full">Na</span>
      {/* Slider line + handle */}
      <div className="absolute inset-y-0 w-0.5 bg-white shadow-lg pointer-events-none" style={{ left: `${pos}%` }} />
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-white shadow-xl border border-black/10 flex items-center justify-center cursor-ew-resize"
        style={{ left: `${pos}%` }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
          <polyline points="15 18 9 12 15 6" />
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  );
};

export default BeforeAfterSlider;
