import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        address: address || null,
        start_date: startDate || null,
        end_date: endDate || null,
        countries: [],
        is_public: isPublic,
      })
      .select()
      .single();

    if (error) {
      toast.error("Kon project niet aanmaken: " + error.message);
    } else {
      toast.success("Project aangemaakt!");
      navigate(`/trip/${data.id}`);
    }
    setLoading(false);
  };

  return (
    <div className="container max-w-2xl py-12">
      <Card>
        <CardHeader>
          <CardTitle>Nieuw verbouwingsproject</CardTitle>
          <CardDescription>Leg de basis voor je verbouwingslogboek.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">Projectnaam *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Bijv. Verbouwing droomhuis 2026" />
            </div>
            <div>
              <Label htmlFor="type">Type project</Label>
              <Select value={projectType} onValueChange={setProjectType}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Kies een type" />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="address">Adres</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Bijv. Hoofdstraat 12, Utrecht" />
            </div>
            <div>
              <Label htmlFor="description">Beschrijving</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Wat is het verhaal van dit project?" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start">Startdatum</Label>
                <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="end">Verwachte einddatum</Label>
                <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
              <Label htmlFor="public">Publiek zichtbaar (anderen kunnen volgen)</Label>
            </div>
            <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={loading}>
              {loading ? "Aanmaken..." : "Project starten"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewTrip;
