import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, X, Search } from "lucide-react";

interface AddStepDialogProps {
  tripId: string;
  onClose: () => void;
  onAdded: () => void;
}

const AddStepDialog = ({ tripId, onClose, onAdded }: AddStepDialogProps) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [country, setCountry] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [description, setDescription] = useState("");
  const [stepDate, setStepDate] = useState(new Date().toISOString().split("T")[0]);
  const [travelHours, setTravelHours] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [geocoding, setGeocoding] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

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
    if (!user) return;
    setLoading(true);

    // Auto-geocode if no coordinates
    if (!latitude && !longitude && locationName) {
      await geocodeLocation();
    }

    const { data: step, error } = await supabase
      .from("steps")
      .insert({
        trip_id: tripId,
        user_id: user.id,
        location_name: locationName,
        country: country || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        description: description || null,
        step_date: stepDate,
        travel_hours: travelHours ? parseFloat(travelHours) : null,
      })
      .select()
      .single();

    if (error) {
      toast.error("Kon stap niet toevoegen: " + error.message);
      setLoading(false);
      return;
    }

    // Upload media
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${step.id}/${i}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("trip-media")
        .upload(path, file);

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("trip-media").getPublicUrl(path);
        await supabase.from("step_media").insert({
          step_id: step.id,
          user_id: user.id,
          media_url: urlData.publicUrl,
          media_type: file.type.startsWith("video") ? "video" : "image",
          sort_order: i,
        });
      }
    }

    toast.success("Stap toegevoegd!");
    onAdded();
    onClose();
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto z-[1000]">
        <DialogHeader>
          <DialogTitle>Stap toevoegen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Locatie *</Label>
            <div className="flex gap-2">
              <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required placeholder="Bijv. Oslo" />
              <Button type="button" variant="outline" size="icon" onClick={geocodeLocation} disabled={geocoding || !locationName.trim()} title="Zoek coördinaten">
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

          {/* File upload */}
          <div>
            <Label>Foto's & Video's</Label>
            <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer hover:border-primary transition-colors">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Klik om bestanden te selecteren</span>
              <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
            </label>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((f, i) => (
                  <div key={i} className="relative group">
                    <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                      {f.type.startsWith("image") ? (
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs">🎥</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Toevoegen..." : "Stap toevoegen"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddStepDialog;
