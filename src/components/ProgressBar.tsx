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
        <div className="flex items-center justify-between mb-1.5 text-xs font-medium">
          <span className="text-muted-foreground uppercase tracking-wider">Voortgang</span>
          <span className="text-accent font-bold">{clamped}%</span>
        </div>
      )}
      <div className={`w-full bg-secondary rounded-full overflow-hidden ${size === "sm" ? "h-1.5" : "h-2.5"}`}>
        <div
          className="h-full bg-gradient-to-r from-accent to-accent/80 transition-all duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};

export default ProgressBar;
