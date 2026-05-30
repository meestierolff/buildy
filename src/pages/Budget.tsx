import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Clock, Hammer, Briefcase, Users, EyeOff, Loader2, Pencil, Check } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { toast } from "sonner";

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const WORK_LABELS: Record<string, { label: string; icon: any }> = {
  diy: { label: "Zelf", icon: Hammer },
  outsourced: { label: "Uitbesteed", icon: Briefcase },
  mixed: { label: "Combinatie", icon: Users },
};

const Budget = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: t }, { data: s }, { data: b }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("steps").select("*").eq("trip_id", id).order("step_date", { ascending: true }),
        supabase.from("step_budget").select("*").eq("trip_id", id),
      ]);
      setTrip(t);
      const budgetMap = new Map((b || []).map((row: any) => [row.step_id, row]));
      const merged = (s || []).map((step: any) => {
        const bud = budgetMap.get(step.id) as any;
        return {
          ...step,
          cost: bud?.cost ?? null,
          hours_spent: bud?.hours_spent ?? null,
          work_type: bud?.work_type ?? null,
          diy_cost: bud?.diy_cost ?? null,
          diy_hours: bud?.diy_hours ?? null,
          outsourced_cost: bud?.outsourced_cost ?? null,
          outsourced_hours: bud?.outsourced_hours ?? null,
        };
      });
      setSteps(merged);
      setLoading(false);
    })();
  }, [id]);

  const isOwner = user && trip?.user_id === user.id;
  const canView = isOwner || (trip?.is_public && trip?.budget_public);

  const totals = useMemo(() => {
    let cost = 0, hours = 0, diy = 0, out = 0, mix = 0;
    steps.forEach((s) => {
      cost += Number(s.cost) || 0;
      hours += Number(s.hours_spent) || 0;
      if (s.work_type === "diy") diy += Number(s.cost) || 0;
      else if (s.work_type === "outsourced") out += Number(s.cost) || 0;
      else if (s.work_type === "mixed") mix += Number(s.cost) || 0;
    });
    return { cost, hours, diy, out, mix };
  }, [steps]);

  const togglePublic = async (val: boolean) => {
    if (!id) return;
    const { error } = await supabase.from("trips").update({ budget_public: val }).eq("id", id);
    if (error) toast.error("Kon niet opslaan");
    else { setTrip((t: any) => ({ ...t, budget_public: val })); toast.success(val ? "Budget nu openbaar" : "Budget nu privé"); }
  };

  const saveBudget = async () => {
    if (!id) return;
    const val = budgetDraft === "" ? null : Number(budgetDraft);
    const { error } = await supabase.from("trips").update({ budget_total: val }).eq("id", id);
    if (error) toast.error("Kon niet opslaan");
    else { setTrip((t: any) => ({ ...t, budget_total: val })); setEditingBudget(false); toast.success("Budget opgeslagen"); }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!trip) return <div className="min-h-screen bg-background flex justify-center items-center text-muted-foreground text-sm">Project niet gevonden</div>;

  if (!canView) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <EmptyState
          icon={EyeOff}
          title="Budget is privé"
          description="De eigenaar heeft het budget van dit project niet openbaar gemaakt."
          action={
            <Link to={`/trip/${id}`}>
              <Button variant="outline" className="rounded-full text-[11px] font-bold uppercase tracking-widest">
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Terug naar project
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const withCost = steps.filter((s) => s.cost != null || s.hours_spent != null);
  const total = trip.budget_total != null ? Number(trip.budget_total) : null;
  const spent = totals.cost;
  const over = total != null && spent > total;
  const pct = total ? Math.min(100, (spent / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 md:px-8 py-12 md:py-16">
        <Link to={`/trip/${id}`} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-10">
          <ArrowLeft className="h-3.5 w-3.5" /> {trip.title}
        </Link>

        <div className="mb-12">
          <p className="eyebrow mb-3">Budget</p>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">Wat de verbouwing kost.</h1>
        </div>

        {/* Budget overview */}
        <section className="border-t border-border pt-10 mb-16">
          <div className="flex items-baseline justify-between gap-3 mb-6">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Verbouwbudget</h2>
            {isOwner && !editingBudget && (
              <button
                onClick={() => { setBudgetDraft(total != null ? String(total) : ""); setEditingBudget(true); }}
                className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors flex items-center gap-1"
              >
                <Pencil className="h-3 w-3" /> {total != null ? "Wijzig" : "Instellen"}
              </button>
            )}
          </div>

          {editingBudget ? (
            <div className="flex items-center gap-2 max-w-md">
              <span className="text-muted-foreground">€</span>
              <Input type="number" min="0" step="100" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} placeholder="Bijv. 50000" autoFocus className="h-11" />
              <Button size="sm" onClick={saveBudget} className="rounded-full bg-foreground text-background hover:bg-foreground/90 h-11 w-11 p-0"><Check className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingBudget(false)} className="text-[11px] font-bold uppercase tracking-widest">Annuleer</Button>
            </div>
          ) : total != null && total > 0 ? (
            <div>
              <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
                <div>
                  <p className="eyebrow mb-1">Besteed</p>
                  <p className={`font-serif italic text-5xl md:text-6xl leading-none ${over ? "text-destructive" : "text-foreground"}`}>{fmtEUR(spent)}</p>
                </div>
                <div className="text-right">
                  <p className="eyebrow mb-1">{over ? "Overschrijding" : "Resterend"}</p>
                  <p className={`font-serif italic text-3xl md:text-4xl leading-none ${over ? "text-destructive" : "text-accent"}`}>{fmtEUR(Math.abs(total - spent))}</p>
                </div>
              </div>
              <div className="w-full h-0.5 bg-muted">
                <div className={`h-full transition-all ${over ? "bg-destructive" : "bg-accent"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground uppercase tracking-widest font-bold mt-2 tabular-nums">
                <span>{Math.round(pct)}% gebruikt</span>
                <span>van {fmtEUR(total)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground font-light">
              {isOwner ? "Stel een verbouwbudget in om je uitgaven te volgen." : "Er is nog geen verbouwbudget ingesteld."}
            </p>
          )}
        </section>

        {/* Stats grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 mb-16 border-t border-border pt-10">
          {[
            { label: "Uren", value: totals.hours, icon: Clock },
            { label: "Zelf gedaan", value: fmtEUR(totals.diy), icon: Hammer },
            { label: "Uitbesteed", value: fmtEUR(totals.out + totals.mix), icon: Briefcase },
            { label: "Totaal", value: fmtEUR(totals.cost), icon: null },
          ].map((s) => (
            <div key={s.label}>
              <p className="eyebrow mb-2">{s.label}</p>
              <p className="font-serif italic text-3xl md:text-4xl leading-none tabular-nums">{s.value}</p>
            </div>
          ))}
        </section>

        {/* Public toggle */}
        {isOwner && (
          <section className="border-t border-border pt-10 pb-10 flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="public-budget" className="font-medium cursor-pointer">Budget openbaar maken</Label>
              <p className="text-xs text-muted-foreground mt-1 font-light">Anderen zien dan dit overzicht bij je project.</p>
            </div>
            <Switch id="public-budget" checked={!!trip.budget_public} onCheckedChange={togglePublic} />
          </section>
        )}

        {/* Per update */}
        <section className="border-t border-border pt-10">
          <div className="flex items-baseline gap-3 mb-6">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Per update</h2>
            <div className="flex-1 h-px bg-border" />
          </div>

          {withCost.length === 0 ? (
            <p className="text-sm text-muted-foreground font-light py-6">Nog geen kosten of uren ingevuld. Voeg ze toe via een update.</p>
          ) : (
            <div>
              {withCost.map((s) => {
                const W = s.work_type ? WORK_LABELS[s.work_type] : null;
                const Icon = W?.icon;
                return (
                  <div key={s.id} className="flex items-center justify-between gap-4 py-5 border-b border-border last:border-b-0">
                    <div className="min-w-0">
                      <p className="font-serif italic text-xl leading-tight truncate">{s.location_name}</p>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-bold mt-1">{new Date(s.step_date).toLocaleDateString("nl-NL")}</p>
                    </div>
                    <div className="flex items-center gap-5 text-sm shrink-0">
                      {W && Icon && (
                        <span className="text-[11px] text-muted-foreground uppercase tracking-widest font-bold flex items-center gap-1">
                          <Icon className="h-3 w-3" /> {W.label}
                        </span>
                      )}
                      {s.hours_spent != null && (
                        <span className="text-muted-foreground text-sm tabular-nums">{s.hours_spent}u</span>
                      )}
                      {s.cost != null && (
                        <span className="font-serif italic text-2xl text-foreground tabular-nums">{fmtEUR(Number(s.cost))}</span>
                      )}
                    </div>
                  </div>
                  {/* Mixed split breakdown */}
                  {s.work_type === "mixed" && (s.diy_cost != null || s.outsourced_cost != null) && (
                    <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground uppercase tracking-widest font-bold">
                      {s.diy_cost != null && (
                        <span className="flex items-center gap-1">
                          <Hammer className="h-3 w-3" /> Zelf: {fmtEUR(Number(s.diy_cost))}{s.diy_hours != null ? ` · ${s.diy_hours}u` : ""}
                        </span>
                      )}
                      {s.outsourced_cost != null && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" /> Uitbesteed: {fmtEUR(Number(s.outsourced_cost))}{s.outsourced_hours != null ? ` · ${s.outsourced_hours}u` : ""}
                        </span>
                      )}
                    </div>
                  )}                  )}
                </div>
              );
            })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Budget;
