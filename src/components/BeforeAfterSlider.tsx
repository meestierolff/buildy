import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from "react";

import { ResilientImage } from "@/components/ResilientMedia";

interface Props {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
  onBeforeClick?: () => void;
  onAfterClick?: () => void;
}

const BeforeAfterSlider = ({ beforeUrl, afterUrl, className = "", onBeforeClick, onAfterClick }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);
  const dragMoved = useRef(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  }, []);

  const handleRootClick = (event: MouseEvent<HTMLDivElement>) => {
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }

    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const clickPos = ((event.clientX - rect.left) / rect.width) * 100;
    if (clickPos <= pos) {
      onBeforeClick?.();
    } else {
      onAfterClick?.();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = true;
    dragMoved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragMoved.current = true;
    updateFromClientX(event.clientX);
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={ref}
      className={`relative w-full aspect-[4/3] overflow-hidden rounded-lg bg-muted select-none cursor-zoom-in ${className}`}
      onClick={handleRootClick}
    >
      <ResilientImage src={afterUrl} alt="Na" fallbackLabel="Na-foto niet beschikbaar" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
      <div
        className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
        style={{ width: `${pos}%` }}
      >
        <ResilientImage
          src={beforeUrl}
          alt="Voor"
          fallbackLabel="Voor-foto niet beschikbaar"
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
        className="absolute inset-y-0 -translate-x-1/2 w-12 cursor-ew-resize touch-none"
        style={{ left: `${pos}%` }}
        onClick={(e) => {
          e.stopPropagation();
          dragMoved.current = false;
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-lg" />
        <div className="absolute top-1/2 left-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-xl border border-black/10 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
            <polyline points="15 18 9 12 15 6" />
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default BeforeAfterSlider;
