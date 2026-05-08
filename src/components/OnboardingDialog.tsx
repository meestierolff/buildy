import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Hammer } from "lucide-react";
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
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("onboarded, display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data && !data.onboarded) {
        setDisplayName(data.display_name || "");
        setOpen(true);
      }
    })();
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
      toast.success("Welkom bij Buildy!");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto bg-accent rounded-xl p-3 mb-2">
            <Hammer className="h-6 w-6 text-accent-foreground" />
          </div>
          <DialogTitle className="text-center">Welkom bij Buildy!</DialogTitle>
          <DialogDescription className="text-center">
            Even je profiel inrichten zodat anderen je verbouwingen kunnen vinden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="dn">Naam</Label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Bijv. Jan Bakker" />
          </div>
          <div>
            <Label htmlFor="loc">Locatie</Label>
            <Input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bijv. Amsterdam" />
          </div>
          <div>
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Wat ga je verbouwen?" rows={3} />
          </div>
          <Button onClick={save} disabled={saving} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
            Aan de slag
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingDialog;
