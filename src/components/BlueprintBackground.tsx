import { memo } from "react";

const BlueprintBackground = memo(() => {
  return (
    <div className="absolute inset-0 pointer-events-none blueprint-grid opacity-90">
      {/* Decorative measurement marks */}
      <svg
        className="absolute inset-0 w-full h-full opacity-30"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id="bp-ticks" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <text x="6" y="14" fontSize="9" fill="hsl(var(--blueprint-line-strong))" fontFamily="DM Sans">
              200
            </text>
            <line x1="0" y1="20" x2="14" y2="20" stroke="hsl(var(--blueprint-line-strong))" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bp-ticks)" />
      </svg>
    </div>
  );
});

BlueprintBackground.displayName = "BlueprintBackground";

export default BlueprintBackground;
