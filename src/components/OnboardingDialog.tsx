import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const OnboardingDialog = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("onboarded, display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data && !data.onboarded) {
        // Use first name part if display_name looks like an email
        const seed = (data.display_name || "").includes("@")
          ? ""
          : data.display_name || "";
        setDisplayName(seed);
        // Soft delay so it doesn't punch in on page load
        setTimeout(() => !cancelled && setOpen(true), 900);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const save = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      toast.error("Geef een naam op");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        location: location.trim() || null,
        bio: bio.trim() || null,
        onboarded: true,
      })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) {
      toast.error("Kon profiel niet opslaan");
    } else {
      toast.success("Welkom bij Buildy");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md rounded-lg">
        <DialogHeader className="space-y-3">
          <p className="eyebrow text-center">Even kennismaken</p>
          <DialogTitle className="text-center font-serif italic text-3xl font-normal">
            Welkom bij Buildy
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground leading-relaxed">
            Vul je profiel aan zodat anderen je verbouwingen kunnen vinden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="dn" className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">Naam</Label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Bijv. Jan Bakker" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc" className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">Locatie</Label>
            <Input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bijv. Amsterdam" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio" className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">Bio</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bijv. jaren-30 woning verduurzamen, keuken openbreken en straks alles bundelen in een Bouwboek." rows={3} />
          </div>
          <Button
            onClick={save}
            disabled={saving}
            className="w-full rounded-full text-[11px] font-bold uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90 h-11"
          >
            Aan de slag
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingDialog;
