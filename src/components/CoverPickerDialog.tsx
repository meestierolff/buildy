import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Image as ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  tripId: string;
  userId: string;
  currentUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const CoverPickerDialog = ({ tripId, userId, currentUrl, onClose, onSaved }: Props) => {
  const { user } = useAuth();
  const [media, setMedia] = useState<{ id: string; media_url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("step_media")
        .select("id, media_url, media_type, steps!inner(trip_id)")
        .eq("steps.trip_id", tripId)
        .eq("media_type", "image");
      setMedia((data as any) || []);
      setLoading(false);
    })();
  }, [tripId]);

  const setCover = async (url: string | null) => {
    setSaving(true);
    const { error } = await supabase.from("trips").update({ cover_image_url: url }).eq("id", tripId);
    setSaving(false);
    if (error) {
      toast.error("Opslaan mislukt");
      return;
    }
    toast.success(url ? "Coverfoto bijgewerkt" : "Coverfoto verwijderd");
    onSaved();
    onClose();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setSaving(true);
    const ext = file.name.split(".").pop();
    const path = `${userId}/cover/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("trip-media").upload(path, file);
    if (upErr) {
      toast.error("Upload mislukt");
      setSaving(false);
      return;
    }
    const { data } = supabase.storage.from("trip-media").getPublicUrl(path);
    await setCover(data.publicUrl);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto z-[1000]">
        <DialogHeader>
          <DialogTitle>Projectfoto kiezen</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Upload className="h-4 w-4" /> Nieuwe foto uploaden
            </Button>
            {currentUrl && (
              <Button
                variant="outline"
                onClick={() => setCover(null)}
                disabled={saving}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> Verwijder huidige
              </Button>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Of kies uit je geüploade foto's</p>
            {loading ? (
              <p className="text-sm text-muted-foreground">Laden...</p>
            ) : media.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nog geen foto's beschikbaar.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {media.map((m) => {
                  const isCurrent = m.media_url === currentUrl;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setCover(m.media_url)}
                      disabled={saving}
                      className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all hover:opacity-90 ${
                        isCurrent ? "border-accent ring-2 ring-accent/40" : "border-transparent"
                      }`}
                    >
                      <img src={m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      {isCurrent && (
                        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
                          <span className="bg-accent text-accent-foreground text-[10px] font-bold uppercase px-1.5 py-0.5 rounded">
                            Cover
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CoverPickerDialog;
