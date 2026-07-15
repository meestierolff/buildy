import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Image as ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { prepareUpload } from "@/lib/compressImage";
import { hydrateMediaUrls, resolvePrivateStoragePath } from "@/lib/mediaUrl";
import { getOwnedPublicTripMediaPath } from "@/lib/storagePaths";

interface Props {
  tripId: string;
  userId: string;
  currentUrl: string | null;
  currentStoragePath?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const CoverPickerDialog = ({ tripId, userId, currentUrl, currentStoragePath, onClose, onSaved }: Props) => {
  const { user } = useAuth();
  const [media, setMedia] = useState<{ id: string; media_url: string; storage_path: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("step_media")
        .select("id, media_url, storage_path, media_type, steps!inner(trip_id)")
        .eq("steps.trip_id", tripId)
        .eq("media_type", "image");
      const rows = (data || []).map((item) => ({
        id: item.id,
        media_url: item.media_url,
        storage_path: item.storage_path,
      }));
      await hydrateMediaUrls(rows);
      setMedia(rows);
      setLoading(false);
    })();
  }, [tripId]);

  const setCover = async (url: string | null, storagePath: string | null = null) => {
    setSaving(true);
    const { error } = await supabase.from("trips").update({
      cover_image_url: storagePath ? null : url,
      cover_storage_path: storagePath,
    }).eq("id", tripId);
    setSaving(false);
    if (error) {
      console.error("Save project cover failed:", error);
      toast.error("Opslaan mislukt");
      return false;
    }
    const coverPrefix = `${userId}/trip-assets/${tripId}/covers/`;
    if (currentStoragePath && currentStoragePath !== storagePath && currentStoragePath.startsWith(coverPrefix)) {
      const { error: cleanupError } = await supabase.storage.from("trip-private").remove([currentStoragePath]);
      if (cleanupError) console.error("Remove replaced project cover failed:", cleanupError);
    } else if (!currentStoragePath && currentUrl) {
      const legacyPath = getOwnedPublicTripMediaPath(currentUrl, userId);
      if (legacyPath) {
        const { data: mediaReferences, error: referenceError } = await supabase
          .from("step_media")
          .select("id")
          .eq("media_url", currentUrl)
          .limit(1);
        if (referenceError) {
          console.error("Check legacy cover references failed:", referenceError);
        } else if (!mediaReferences?.length) {
          const { error: cleanupError } = await supabase.storage.from("trip-media").remove([legacyPath]);
          if (cleanupError) console.error("Remove legacy project cover failed:", cleanupError);
        }
      }
    }
    toast.success(url ? "Coverfoto bijgewerkt" : "Coverfoto verwijderd");
    onSaved();
    onClose();
    return true;
  };

  const uploadPrivateCover = async (file: Blob, extension: string) => {
    setSaving(true);
    const path = `${userId}/trip-assets/${tripId}/covers/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("trip-private")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      console.error("Upload project cover failed:", uploadError);
      toast.error("Upload mislukt");
      setSaving(false);
      return;
    }

    const signedUrl = await resolvePrivateStoragePath(path);
    if (!signedUrl) {
      await supabase.storage.from("trip-private").remove([path]);
      toast.error("Cover kon niet veilig worden geladen");
      setSaving(false);
      return;
    }

    const saved = await setCover(signedUrl, path);
    if (!saved) await supabase.storage.from("trip-private").remove([path]);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setSaving(true);
    try {
      const prepared = await prepareUpload(file);
      if (!prepared.type.startsWith("image/")) throw new Error("Geen afbeelding");
      const extension = prepared.name.split(".").pop()?.toLowerCase() || "jpg";
      setSaving(false);
      await uploadPrivateCover(prepared, extension);
    } catch (error) {
      console.error("Prepare project cover failed:", error);
      toast.error(error instanceof Error ? error.message : "Deze afbeelding wordt niet ondersteund");
      setSaving(false);
    }
  };

  const chooseExisting = async (item: { media_url: string; storage_path: string | null }) => {
    setSaving(true);
    let blob: Blob | null = null;
    if (item.storage_path) {
      const result = await supabase.storage.from("trip-private").download(item.storage_path);
      if (result.error) console.error("Download private step cover source failed:", result.error);
      blob = result.data;
    } else {
      try {
        const response = await fetch(item.media_url);
        if (response.ok) blob = await response.blob();
      } catch (error) {
        console.error("Download legacy step cover source failed:", error);
      }
    }
    if (!blob) {
      toast.error("Foto kon niet als cover worden ingesteld");
      setSaving(false);
      return;
    }
    const extensionByMime: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    };
    const extension = extensionByMime[blob.type] || "jpg";
    setSaving(false);
    await uploadPrivateCover(blob, extension);
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
                onClick={() => setCover(null, null)}
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
                  const isCurrent = m.storage_path
                    ? m.storage_path === currentStoragePath
                    : m.media_url === currentUrl;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => chooseExisting(m)}
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
