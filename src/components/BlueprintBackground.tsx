import { memo, useId } from "react";

const BlueprintBackground = memo(() => {
  const uid = useId().replace(/:/g, "");
  const gridId = `bp-grid-${uid}`;
  const majorGridId = `bp-major-grid-${uid}`;
  const toolsId = `bp-tools-${uid}`;
  const grainId = `bp-grain-${uid}`;
  const line = "hsl(var(--blueprint-line-strong))";
  const softLine = "hsl(var(--blueprint-line))";

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[#f7f8f4]">
      <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id={grainId} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="11" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="table" tableValues="0 0.035" />
            </feComponentTransfer>
          </filter>

          <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 H 0 V 24" fill="none" stroke={softLine} strokeOpacity="0.18" strokeWidth="1" />
          </pattern>
          <pattern id={majorGridId} width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill={`url(#${gridId})`} />
            <path d="M 120 0 H 0 V 120" fill="none" stroke={softLine} strokeOpacity="0.38" strokeWidth="1" />
          </pattern>

          <pattern id={toolsId} width="520" height="420" patternUnits="userSpaceOnUse">
            <g fill="none" stroke={line} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" opacity="0.26">
              {/* Folding ruler */}
              <g transform="translate(60 58) rotate(-8)">
                <rect x="0" y="0" width="144" height="18" rx="3" />
                {Array.from({ length: 13 }).map((_, i) => (
                  <path key={`ruler-${i}`} d={`M ${10 + i * 10} 0 V ${i % 2 === 0 ? 10 : 6}`} />
                ))}
                <path d="M 18 18 L 74 56 L 84 42 L 28 4" />
                <circle cx="74" cy="48" r="4" />
              </g>

              {/* Compass */}
              <g transform="translate(342 28) rotate(12)">
                <circle cx="42" cy="24" r="7" />
                <path d="M 42 31 L 12 122" />
                <path d="M 42 31 L 84 118" />
                <path d="M 25 78 Q 45 91 68 78" />
                <path d="M 10 122 L 3 132" />
                <path d="M 84 118 L 94 126" />
              </g>

              {/* Pencil */}
              <g transform="translate(270 198) rotate(-26)">
                <path d="M 0 10 H 132 L 154 20 L 132 30 H 0 Z" />
                <path d="M 132 10 V 30" />
                <path d="M 146 16 L 138 24" />
                <path d="M 18 10 V 30" />
                <path d="M 8 13 V 27" />
              </g>

              {/* Drill */}
              <g transform="translate(46 260) rotate(6)">
                <path d="M 18 36 H 86 L 104 25 H 130" />
                <path d="M 22 20 H 82 L 96 36 L 82 52 H 22 Z" />
                <path d="M 48 52 L 38 106 H 64 L 76 52" />
                <path d="M 58 106 H 83" />
                <path d="M 104 25 L 100 16 H 118 L 130 25" />
                <circle cx="44" cy="36" r="8" />
              </g>

              {/* Hammer */}
              <g transform="translate(368 268) rotate(-18)">
                <path d="M 20 20 H 104 L 116 34 L 106 48 H 70" />
                <path d="M 72 42 L 142 130" />
                <path d="M 132 136 L 150 122" />
                <path d="M 16 20 L 6 32 L 22 44" />
              </g>

              {/* Measuring tape */}
              <g transform="translate(218 332) rotate(9)">
                <rect x="0" y="0" width="82" height="54" rx="14" />
                <circle cx="36" cy="27" r="13" />
                <path d="M 78 24 C 122 14 148 18 180 36" />
                <path d="M 176 31 L 188 43" />
                {Array.from({ length: 7 }).map((_, i) => (
                  <path key={`tape-${i}`} d={`M ${102 + i * 11} ${21 + i % 2} L ${99 + i * 11} ${31 + i % 2}`} />
                ))}
              </g>
            </g>

            <g fill={line} opacity="0.18" fontFamily="DM Sans, sans-serif" fontSize="9">
              <text x="18" y="178">schaal 1:50</text>
              <text x="392" y="188">maatvoering</text>
              <text x="166" y="394">renovatieplan</text>
            </g>
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill={`url(#${majorGridId})`} />
        <rect width="100%" height="100%" fill={`url(#${toolsId})`} />
        <rect width="100%" height="100%" filter={`url(#${grainId})`} opacity="0.8" />

        <g fill="none" stroke={line} strokeLinecap="round" opacity="0.16">
          <path d="M -40 310 C 170 260 260 370 440 314 S 770 236 980 306 S 1260 390 1500 300" />
          <path d="M 0 740 C 170 700 310 786 488 732 S 806 650 1010 726 S 1240 804 1480 714" />
        </g>

        <g fill="none" stroke={line} strokeWidth="1" opacity="0.2">
          {Array.from({ length: 8 }).map((_, i) => (
            <g key={`mark-${i}`} transform={`translate(${90 + i * 185} ${150 + (i % 3) * 220})`}>
              <path d="M 0 0 H 22" />
              <path d="M 11 -8 V 8" />
              <text x="28" y="4" fill={line} stroke="none" fontFamily="DM Sans, sans-serif" fontSize="9">
                {120 + i * 20}
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/55" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" />
    </div>
  );
});

BlueprintBackground.displayName = "BlueprintBackground";

export default BlueprintBackground;
