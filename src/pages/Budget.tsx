import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Wallet, Clock, Hammer, Briefcase, Users, EyeOff, Loader2 } from "lucide-react";
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

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: t }, { data: s }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("steps").select("*").eq("trip_id", id).order("step_date", { ascending: true }),
      ]);
      setTrip(t);
      setSteps(s || []);
      setLoading(false);
    })();
  }, [id]);

  const isOwner = user && trip?.user_id === user.id;
  const canView = isOwner || (trip?.is_public && trip?.budget_public);

  const totals = useMemo(() => {
    let cost = 0,
      hours = 0,
      diy = 0,
      out = 0,
      mix = 0;
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
    else {
      setTrip((t: any) => ({ ...t, budget_public: val }));
      toast.success(val ? "Budget nu openbaar" : "Budget nu privé");
    }
  };

  if (loading) {
    return (
      <div className="container py-20 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!trip) return <div className="container py-20 text-center">Project niet gevonden</div>;

  if (!canView) {
    return (
      <div className="container max-w-2xl py-20 text-center">
        <EyeOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <h1 className="text-2xl font-bold mb-2">Budget is privé</h1>
        <p className="text-muted-foreground mb-6">De eigenaar heeft het budget van dit project niet openbaar gemaakt.</p>
        <Link to={`/trip/${id}`}>
          <Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" /> Terug naar project</Button>
        </Link>
      </div>
    );
  }

  const withCost = steps.filter((s) => s.cost != null || s.hours_spent != null);

  return (
    <div className="container max-w-4xl py-10">
      <Link to={`/trip/${id}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Terug naar {trip.title}
      </Link>

      <div className="flex items-center gap-2 mb-2">
        <Wallet className="h-6 w-6 text-accent" />
        <h1 className="text-3xl font-bold">Budget</h1>
      </div>
      <p className="text-muted-foreground mb-6">Overzicht van kosten en uren per update.</p>

      {isOwner && (
        <Card className="mb-6">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="public-budget" className="font-semibold cursor-pointer">Budget openbaar maken</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Anderen zien dan dit overzicht bij je project.</p>
            </div>
            <Switch id="public-budget" checked={!!trip.budget_public} onCheckedChange={togglePublic} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Totaal</div>
          <div className="text-2xl font-bold text-accent">{fmtEUR(totals.cost)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Uren</div>
          <div className="text-2xl font-bold">{totals.hours}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Hammer className="h-3 w-3" /> Zelf gedaan</div>
          <div className="text-lg font-bold">{fmtEUR(totals.diy)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" /> Uitbesteed</div>
          <div className="text-lg font-bold">{fmtEUR(totals.out + totals.mix)}</div>
        </CardContent></Card>
      </div>

      <h2 className="text-lg font-semibold mb-3">Per update</h2>
      {withCost.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Nog geen kosten of uren ingevuld. Voeg ze toe via een update.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {withCost.map((s) => {
            const W = s.work_type ? WORK_LABELS[s.work_type] : null;
            const Icon = W?.icon;
            return (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{s.location_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(s.step_date).toLocaleDateString("nl-NL")}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    {W && Icon && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Icon className="h-3 w-3" /> {W.label}
                      </span>
                    )}
                    {s.hours_spent != null && (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {s.hours_spent}u
                      </span>
                    )}
                    {s.cost != null && (
                      <span className="font-bold text-accent">{fmtEUR(Number(s.cost))}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Budget;
