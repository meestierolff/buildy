import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const NewTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [countries, setCountries] = useState("");
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
        start_date: startDate || null,
        end_date: endDate || null,
        countries: countries ? countries.split(",").map((c) => c.trim()) : [],
        is_public: isPublic,
      })
      .select()
      .single();

    if (error) {
      toast.error("Kon trip niet aanmaken: " + error.message);
    } else {
      toast.success("Trip aangemaakt!");
      navigate(`/trip/${data.id}`);
    }
    setLoading(false);
  };

  return (
    <div className="container max-w-2xl py-12">
      <Card>
        <CardHeader>
          <CardTitle>Nieuwe Trip</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">Titel *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Bijv. Scandinavië Roadtrip 2026" />
            </div>
            <div>
              <Label htmlFor="description">Beschrijving</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Waar gaat deze trip over?" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start">Startdatum</Label>
                <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="end">Einddatum</Label>
                <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="countries">Landen (kommagescheiden)</Label>
              <Input id="countries" value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="Nederland, Duitsland, Denemarken" />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
              <Label htmlFor="public">Publiek zichtbaar</Label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Aanmaken..." : "Trip aanmaken"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewTrip;
