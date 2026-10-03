import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PrivateMomentDraft } from "@/lib/privateMomentForm";

export default function PrivateMomentFields({ value, onChange, disabled = false, idPrefix }: {
  value: PrivateMomentDraft; onChange: (value: PrivateMomentDraft) => void; disabled?: boolean; idPrefix: string;
}) {
  return (
    <details className="rounded-xl border border-border px-3">
      <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium">Eigen aantekeningen, kosten en uren</summary>
      <div className="space-y-4 pb-4">
        <p className="text-xs text-muted-foreground">Alleen jij ziet dit. Het komt niet in je gedeelde verhaal of Bouwboek.</p>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-notes`}>Eigen aantekeningen</Label>
          <Textarea id={`${idPrefix}-notes`} value={value.notes} onChange={(event) => onChange({ ...value, notes: event.target.value })} maxLength={10000} rows={3} disabled={disabled} className="text-base" placeholder="Bijvoorbeeld maten, materiaalkeuzes of afspraken" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-cost`}>Kosten van dit Bouwmoment (€)</Label>
          <Input id={`${idPrefix}-cost`} inputMode="decimal" value={value.cost} onChange={(event) => onChange({ ...value, cost: event.target.value })} disabled={disabled} placeholder="0,00" className="h-12 text-base" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label htmlFor={`${idPrefix}-own-hours`}>Eigen uren</Label><Input id={`${idPrefix}-own-hours`} inputMode="decimal" value={value.ownHours} onChange={(event) => onChange({ ...value, ownHours: event.target.value })} disabled={disabled} placeholder="0" className="h-12 text-base" /></div>
          <div className="space-y-2"><Label htmlFor={`${idPrefix}-contractor-hours`}>Uren aannemer</Label><Input id={`${idPrefix}-contractor-hours`} inputMode="decimal" value={value.contractorHours} onChange={(event) => onChange({ ...value, contractorHours: event.target.value })} disabled={disabled} placeholder="0" className="h-12 text-base" /></div>
        </div>
      </div>
    </details>
  );
}
