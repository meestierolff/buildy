import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface LegalPendingNoticeProps {
  title: string;
  children: ReactNode;
}

const LegalPendingNotice = ({ title, children }: LegalPendingNoticeProps) => (
  <aside
    className="not-prose mb-8 flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-amber-950"
    aria-label="Openstaande informatie voor livegang"
  >
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <div className="space-y-1 text-sm leading-relaxed">
      <p className="font-semibold">{title}</p>
      <div>{children}</div>
    </div>
  </aside>
);

export default LegalPendingNotice;
