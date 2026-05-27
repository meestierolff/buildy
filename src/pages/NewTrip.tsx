import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const PROJECT_TYPES = [
  "Volledige renovatie",
  "Keuken",
  "Badkamer",
  "Aanbouw",
  "Zolder",
  "Tuin",
  "Nieuwbouw",
  "Anders",
];

const NewTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState<string>("");
  const [address, setAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("trips")
      .insert({
        user_id: user.id,
        title,
        description: description || null,
        project_type: projectType || null,
        start_date: startDate || null,
        end_date: endDate || null,
        countries: [],
        is_public: isPublic,
      })
      .select()
      .single();

    if (error) {
      toast.error("Kon project niet aanmaken. Probeer het opnieuw.");
    } else {
      if (address) {
        await supabase.from("trip_private_info").insert({ trip_id: data.id, address });
      }
      toast.success("Project aangemaakt!");
      navigate(`/trip/${data.id}`);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 md:px-8 py-12 md:py-20">
        <Link to="/" className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-10">
          <ArrowLeft className="h-3.5 w-3.5" /> Terug
        </Link>

        <div className="mb-12">
          <p className="eyebrow mb-3">Nieuw project</p>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">
            Leg de basis voor je verbouwing.
          </h1>
          <p className="text-sm text-muted-foreground mt-4 font-light max-w-md">
            Geef je project een naam en je kunt later updates, foto's en plattegronden toevoegen.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title" className="eyebrow">Projectnaam</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Bijv. Verbouwing droomhuis 2026" className="h-11" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" className="eyebrow">Type project</Label>
            <Select value={projectType} onValueChange={setProjectType}>
              <SelectTrigger id="type" className="h-11"><SelectValue placeholder="Kies een type" /></SelectTrigger>
              <SelectContent>
                {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address" className="eyebrow">Adres (privé)</Label>
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Bijv. Hoofdstraat 12, Utrecht" className="h-11" />
            <p className="text-xs text-muted-foreground">Alleen jij ziet dit adres.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="eyebrow">Beschrijving</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Wat is het verhaal van dit project?" rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start" className="eyebrow">Startdatum</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end" className="eyebrow">Verwachte einddatum</Label>
              <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-11" />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 py-4 border-t border-border">
            <div>
              <Label htmlFor="public" className="font-medium">Publiek zichtbaar</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Anderen kunnen je project volgen en updates zien.</p>
            </div>
            <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90"
          >
            {loading ? "Aanmaken…" : "Project starten"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default NewTrip;
