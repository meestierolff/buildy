import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Hammer, MapPin, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type SaveAction = "profile" | "project" | null;

const OnboardingDialog = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [savingAction, setSavingAction] = useState<SaveAction>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let openTimer: ReturnType<typeof setTimeout> | undefined;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("onboarded, display_name, location, bio")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("Onboarding profile load failed", error);
        return;
      }
      if (data?.onboarded) return;

      const metadataName = user.user_metadata.display_name || user.user_metadata.full_name || "";
      const currentName = data?.display_name || metadataName;
      setDisplayName(currentName.includes("@") ? "" : currentName);
      setLocation(data?.location || "");
      setBio(data?.bio || "");
      openTimer = setTimeout(() => !cancelled && setOpen(true), 700);
    };

    void loadProfile();
    return () => {
      cancelled = true;
      if (openTimer) clearTimeout(openTimer);
    };
  }, [user]);

  const save = async (action: Exclude<SaveAction, null>) => {
    if (!user || savingAction) return;
    const normalizedName = displayName.trim();
    if (normalizedName.length < 2) {
      toast.error("Vul een naam van minimaal twee tekens in.");
      return;
    }

    setSavingAction(action);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          user_id: user.id,
          display_name: normalizedName,
          location: location.trim() || null,
          bio: bio.trim() || null,
          onboarded: true,
        }, { onConflict: "user_id" });

      if (error) {
        console.error("Onboarding profile save failed", error);
        toast.error("Kon je profiel niet opslaan. Probeer het opnieuw.");
        return;
      }

      toast.success(`Welkom bij Buildy, ${normalizedName.split(" ")[0]}!`);
      setOpen(false);
      if (action === "project") navigate("/trips/new");
    } catch (error) {
      console.error("Unexpected onboarding failure", error);
      toast.error("Er ging iets mis. Controleer je verbinding en probeer opnieuw.");
    } finally {
      setSavingAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !savingAction && setOpen(nextOpen)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border-border p-0 sm:max-w-lg">
        <div className="border-b border-border bg-secondary/55 px-6 py-7 text-center sm:px-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm">
            <Hammer className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogHeader className="mt-5 space-y-3 text-center">
            <p className="eyebrow text-accent">Welkom bij Buildy</p>
            <DialogTitle className="font-serif text-4xl font-normal italic leading-tight">
              Geef je dagboek een gezicht.
            </DialogTitle>
            <DialogDescription className="mx-auto max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
              Zo herkennen vrienden en andere verbouwers jouw projecten. Je kunt alles later aanpassen.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-7 sm:px-8">
          <div className="space-y-2">
            <Label htmlFor="onboarding-name" className="flex items-center gap-2 text-xs font-semibold">
              <UserRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Naam
            </Label>
            <Input
              id="onboarding-name"
              name="name"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Bijv. Sol"
              minLength={2}
              maxLength={60}
              className="h-11 rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-location" className="flex items-center gap-2 text-xs font-semibold">
              <MapPin className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Plaats <span className="font-normal text-muted-foreground">(optioneel)</span>
            </Label>
            <Input
              id="onboarding-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Bijv. Utrecht"
              maxLength={80}
              className="h-11 rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="onboarding-bio" className="text-xs font-semibold">Over jouw plan <span className="font-normal text-muted-foreground">(optioneel)</span></Label>
              <span className="text-[10px] tabular-nums text-muted-foreground">{bio.length}/180</span>
            </div>
            <Textarea
              id="onboarding-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Bijv. We verduurzamen een jaren-30 woning en breken de keuken open."
              rows={3}
              maxLength={180}
              className="resize-none rounded-lg"
            />
          </div>

          <div className="rounded-xl border border-accent/20 bg-accent/[0.07] p-4 text-xs leading-relaxed text-muted-foreground">
            <BookOpen className="mb-2 h-4 w-4 text-accent" aria-hidden="true" />
            Elke update die je hierna toevoegt, bouwt automatisch mee aan je latere Bouwboek.
          </div>

          <div className="space-y-3 pt-1">
            <Button type="button" variant="pill" className="h-12 w-full" disabled={Boolean(savingAction)} onClick={() => save("project")}>
              {savingAction === "project" ? "Profiel opslaan…" : "Opslaan en project starten"}
            </Button>
            <Button type="button" variant="ghost" className="h-10 w-full text-xs text-muted-foreground" disabled={Boolean(savingAction)} onClick={() => save("profile")}>
              {savingAction === "profile" ? "Profiel opslaan…" : "Alleen profiel opslaan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingDialog;
