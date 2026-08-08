import { useBetaStatus } from "@/hooks/useBeta";

export default function BetaBadge({ className = "" }: { className?: string }) {
  const status = useBetaStatus();
  // Fail closed in the interface too: an unavailable status endpoint must not
  // accidentally advertise public registration.
  if (status.data?.betaMode === false) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full border border-amber-500/35 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-900 ${className}`}
      aria-label="Buildy private bèta"
    >
      Private bèta
    </span>
  );
}
