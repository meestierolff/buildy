import { memo, useId } from "react";

const BlueprintBackground = memo(() => {
  const uid = useId().replace(/:/g, "");
  const fineGridId = `bp-fine-${uid}`;
  const mediumGridId = `bp-medium-${uid}`;
  const majorGridId = `bp-major-${uid}`;
  const grainId = `bp-grain-${uid}`;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[#087fbd]">
      <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id={grainId} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="17" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="table" tableValues="0 0.045" />
            </feComponentTransfer>
          </filter>

          <pattern id={fineGridId} width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 H 0 V 8" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          </pattern>
          <pattern id={mediumGridId} width="40" height="40" patternUnits="userSpaceOnUse">
            <rect width="40" height="40" fill={`url(#${fineGridId})`} />
            <path d="M 40 0 H 0 V 40" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
          </pattern>
          <pattern id={majorGridId} width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill={`url(#${mediumGridId})`} />
            <path d="M 120 0 H 0 V 120" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.2" />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="#087fbd" />
        <rect width="100%" height="100%" fill={`url(#${majorGridId})`} />
        <rect width="100%" height="100%" fill="rgba(5,82,134,0.18)" filter={`url(#${grainId})`} />

        <rect
          x="3%"
          y="8%"
          width="94%"
          height="84%"
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="1.2"
        />
      </svg>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.14),transparent_38%),linear-gradient(to_bottom,rgba(0,58,98,0.12),rgba(0,58,98,0.28))]" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/85 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background/70 to-transparent" />
    </div>
  );
});

BlueprintBackground.displayName = "BlueprintBackground";

export default BlueprintBackground;
