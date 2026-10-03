import { useEffect, useState } from "react";
import type { ProjectOverview } from "../../../shared/contracts/projects";
import { useUpdateProjectMutation } from "@/hooks/useProjectApi";
import { parsePrivateNumber } from "@/lib/privateMomentForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const euro = (minor: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(minor / 100);
const hours = (minutes: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 }).format(minutes / 60);

export default function ProjectBudgetPanel({ project }: { project: ProjectOverview }) {
  const update = useUpdateProjectMutation(project.id);
  const budget = project.budget;
  const [planned, setPlanned] = useState(String((budget?.plannedAmountMinor ?? 0) / 100));
  useEffect(() => { setPlanned(String((budget?.plannedAmountMinor ?? 0) / 100)); }, [budget?.plannedAmountMinor]);
  if (!project.canEdit) return null;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await update.mutateAsync({ expectedVersion: project.version, plannedBudgetMinor: parsePrivateNumber(planned, 100, 2_000_000_000) });
      toast.success("Bouwbudget opgeslagen");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Bouwbudget opslaan is niet gelukt."); }
  };
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5" aria-label="Bouwbudget">
      <div><h2 className="font-sans text-lg font-semibold">Bouwbudget</h2><p className="mt-1 text-sm text-muted-foreground">Alleen zichtbaar voor jou. Kosten en uren tel je op via je Bouwmomenten.</p></div>
      <form onSubmit={save} className="space-y-2">
        <Label htmlFor="project-budget">Gepland bouwbudget (€)</Label>
        <div className="flex gap-2"><Input id="project-budget" inputMode="decimal" value={planned} onChange={(event) => setPlanned(event.target.value)} className="h-12 min-w-0 flex-1 text-base" disabled={update.isPending} /><Button type="submit" className="h-12 shrink-0" disabled={update.isPending}>Opslaan</Button></div>
      </form>
      <dl className="grid grid-cols-2 gap-4">
        <div><dt className="text-sm text-muted-foreground">Uitgegeven</dt><dd className="mt-1 text-lg font-semibold">{euro(budget?.spentAmountMinor ?? 0)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">{(budget?.remainingAmountMinor ?? 0) < 0 ? "Boven budget" : "Resterend"}</dt><dd className={`mt-1 text-lg font-semibold ${(budget?.remainingAmountMinor ?? 0) < 0 ? "text-destructive" : ""}`}>{euro(Math.abs(budget?.remainingAmountMinor ?? 0))}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Eigen uren</dt><dd className="mt-1 font-semibold">{hours(budget?.ownMinutes ?? 0)} uur</dd></div>
        <div><dt className="text-sm text-muted-foreground">Uren aannemer</dt><dd className="mt-1 font-semibold">{hours(budget?.contractorMinutes ?? 0)} uur</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Uren zijn apart bijgehouden; er wordt geen uurtarief bij de kosten opgeteld. Verwijderde Bouwmomenten tellen niet mee.</p>
    </section>
  );
}
