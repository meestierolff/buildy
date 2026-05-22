interface ProgressBarProps {
  value: number; // 0-100
  showLabel?: boolean;
  size?: "sm" | "md";
}

const ProgressBar = ({ value, showLabel = true, size = "md" }: ProgressBarProps) => {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow">Voortgang</span>
          <span className="text-[10px] font-bold tabular-nums tracking-widest text-foreground">{clamped}%</span>
        </div>
      )}
      <div className={`w-full bg-muted overflow-hidden ${size === "sm" ? "h-0.5" : "h-[3px]"}`}>
        <div
          className="h-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};

export default ProgressBar;
