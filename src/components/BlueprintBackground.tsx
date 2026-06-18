import { memo, useId } from "react";

/**
 * Rustige, "bouwpapier"-achtergrond: warm wit met fijne potloodlijnen
 * en een subtiel diagonaal streep-patroon dat doet denken aan ruw bouwpapier.
 */
const BlueprintBackground = memo(() => {
  const uid = useId().replace(/:/g, "");
  const stripesId = `bp-stripes-${uid}`;
  const gridId = `bp-grid-${uid}`;
  const grainId = `bp-grain-${uid}`;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[#f6f1e7]">
      <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id={grainId} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="table" tableValues="0 0.05" />
            </feComponentTransfer>
          </filter>

          {/* Subtiele diagonale strepen — bouwpapier-gevoel */}
          <pattern id={stripesId} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="14" height="14" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="14" stroke="rgba(80,60,40,0.05)" strokeWidth="1" />
          </pattern>

          {/* Fijn architecten-grid, nauwelijks zichtbaar */}
          <pattern id={gridId} width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 H 0 V 48" fill="none" stroke="rgba(60,45,30,0.07)" strokeWidth="0.8" />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="#f6f1e7" />
        <rect width="100%" height="100%" fill={`url(#${stripesId})`} />
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <rect width="100%" height="100%" fill="rgba(120,90,55,0.06)" filter={`url(#${grainId})`} />
      </svg>

      {/* Zachte vignet / fade naar pagina-achtergrond */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.55),transparent_55%)]" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
});

BlueprintBackground.displayName = "BlueprintBackground";

export default BlueprintBackground;
