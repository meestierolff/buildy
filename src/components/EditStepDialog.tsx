import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search } from "lucide-react";

interface EditStepDialogProps {
  step: any;
  onClose: () => void;
  onUpdated: () => void;
}

const EditStepDialog = ({ step, onClose, onUpdated }: EditStepDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [locationName, setLocationName] = useState(step.location_name);
  const [country, setCountry] = useState(step.country || "");
  const [latitude, setLatitude] = useState(step.latitude?.toString() || "");
  const [longitude, setLongitude] = useState(step.longitude?.toString() || "");
  const [description, setDescription] = useState(step.description || "");
  const [stepDate, setStepDate] = useState(step.step_date);
  const [travelHours, setTravelHours] = useState(step.travel_hours?.toString() || "");
  const [geocoding, setGeocoding] = useState(false);

  const geocodeLocation = async () => {
    if (!locationName.trim()) return;
    setGeocoding(true);
    try {
      const query = country ? `${locationName}, ${country}` : locationName;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
      );
      const data = await res.json();
      if (data.length > 0) {
        setLatitude(data[0].lat);
        setLongitude(data[0].lon);
        if (!country && data[0].display_name) {
          const parts = data[0].display_name.split(", ");
          setCountry(parts[parts.length - 1]);
        }
        toast.success("Locatie gevonden!");
      } else {
        toast.error("Locatie niet gevonden");
      }
    } catch {
      toast.error("Kon locatie niet opzoeken");
    }
    setGeocoding(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase
      .from("steps")
      .update({
        location_name: locationName,
        country: country || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        description: description || null,
        step_date: stepDate,
        travel_hours: travelHours ? parseFloat(travelHours) : null,
      })
      .eq("id", step.id);

    if (error) {
      toast.error("Kon stap niet bijwerken: " + error.message);
    } else {
      toast.success("Stap bijgewerkt!");
      onUpdated();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto z-[1000]">
        <DialogHeader>
          <DialogTitle>Stap bewerken</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Locatie *</Label>
            <div className="flex gap-2">
              <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required placeholder="Bijv. Oslo" />
              <Button type="button" variant="outline" size="icon" onClick={geocodeLocation} disabled={geocoding || !locationName.trim()}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <Label>Land</Label>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Bijv. Noorwegen" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Breedtegraad</Label>
              <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="59.9139" type="number" step="any" />
            </div>
            <div>
              <Label>Lengtegraad</Label>
              <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="10.7522" type="number" step="any" />
            </div>
          </div>
          {latitude && longitude && (
            <p className="text-xs text-muted-foreground">📍 {parseFloat(latitude).toFixed(4)}, {parseFloat(longitude).toFixed(4)}</p>
          )}
          <div>
            <Label>Datum *</Label>
            <Input type="date" value={stepDate} onChange={(e) => setStepDate(e.target.value)} required />
          </div>
          <div>
            <Label>Reistijd (uren)</Label>
            <Input value={travelHours} onChange={(e) => setTravelHours(e.target.value)} placeholder="3.5" type="number" step="0.5" />
          </div>
          <div>
            <Label>Verhaal</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Schrijf over deze dag..." rows={4} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Opslaan..." : "Opslaan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditStepDialog;
