import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImagePlus, MoveVertical, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: any;
  coverY: number;
  onCoverYChange: (y: number) => void;
  onOpenCoverPicker: () => void;
  onChanged: () => void;
}

export default function ProjectSettingsSheet({
  open,
  onOpenChange,
  trip,
  coverY,
  onCoverYChange,
  onOpenCoverPicker,
  onChanged,
}: Props) {
  // Basisgegevens
  const [titleDraft, setTitleDraft] = useState<string>(trip?.title ?? "");
  const [projectTypeDraft, setProjectTypeDraft] = useState<string>(trip?.project_type ?? "");
  const [addressDraft, setAddressDraft] = useState<string>(trip?.address ?? "");
  const [descDraft, setDescDraft] = useState<string>(trip?.description ?? "");
  const [startDateDraft, setStartDateDraft] = useState<string>(trip?.start_date ?? "");
  const [endDateDraft, setEndDateDraft] = useState<string>(trip?.end_date ?? "");
  const [isPublicDraft, setIsPublicDraft] = useState<boolean>(trip?.is_public ?? true);
  const [savingBasics, setSavingBasics] = useState(false);

  const hasEnd = !!trip?.end_date && !!trip?.start_date;
  const [progressMode, setProgressMode] = useState<"auto" | "manual">(
    trip?.progress_mode === "auto" && hasEnd ? "auto" : "manual"
  );
  const [manualVal, setManualVal] = useState<number>(trip?.progress_percentage ?? 0);

  useEffect(() => {
    setTitleDraft(trip?.title ?? "");
    setProjectTypeDraft(trip?.project_type ?? "");
    setAddressDraft(trip?.address ?? "");
    setDescDraft(trip?.description ?? "");
    setStartDateDraft(trip?.start_date ?? "");
    setEndDateDraft(trip?.end_date ?? "");
    setIsPublicDraft(trip?.is_public ?? true);
    setProgressMode(trip?.progress_mode === "auto" && hasEnd ? "auto" : "manual");
    setManualVal(trip?.progress_percentage ?? 0);
  }, [trip, hasEnd]);

  const saveBasics = async () => {
    if (!titleDraft.trim()) { toast.error("Projectnaam is verplicht"); return; }
    setSavingBasics(true);
    const { error } = await supabase.from("trips").update({
      title: titleDraft.trim(),
      project_type: projectTypeDraft || null,
      description: descDraft.trim() || null,
      start_date: startDateDraft || null,
      end_date: endDateDraft || null,
      is_public: isPublicDraft,
    }).eq("id", trip.id);
    if (error) { toast.error("Opslaan mislukt."); setSavingBasics(false); return; }
    // Address lives in trip_private_info
    await supabase.from("trip_private_info").upsert({
      trip_id: trip.id,
      address: addressDraft.trim() || null,
    });
    setSavingBasics(false);
    toast.success("Instellingen opgeslagen");
    onChanged();
  };

  const persistProgressMode = async (next: "auto" | "manual") => {
    setProgressMode(next);
    const { error } = await supabase.from("trips").update({ progress_mode: next }).eq("id", trip.id);
    if (error) toast.error("Kon modus niet opslaan");
    else onChanged();
  };

  const persistManual = async (v: number) => {
    setManualVal(v);
    const { error } = await supabase
      .from("trips")
      .update({ progress_percentage: v, progress_mode: "manual" })
      .eq("id", trip.id);
    if (error) toast.error("Kon voortgang niet opslaan");
    else onChanged();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Projectinstellingen</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">

          {/* ── Basisgegevens ── */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Basisgegevens</h3>

            <div className="space-y-1.5">
              <Label htmlFor="s-title">Projectnaam *</Label>
              <Input
                id="s-title"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Bijv. Verbouwing droomhuis 2026"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="s-type">Type project</Label>
              <Select
                value={projectTypeDraft || "__none__"}
                onValueChange={(v) => setProjectTypeDraft(v === "__none__" ? "" : v)}
              >
                <SelectTrigger id="s-type">
                  <SelectValue placeholder="Kies een type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Geen —</SelectItem>
                  {PROJECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="s-address">Adres</Label>
              <Input
                id="s-address"
                value={addressDraft}
                onChange={(e) => setAddressDraft(e.target.value)}
                placeholder="Bijv. Hoofdstraat 12, Utrecht"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="s-desc">Beschrijving</Label>
              <Textarea
                id="s-desc"
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={3}
                placeholder="Wat is het verhaal van dit project?"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-start">Startdatum</Label>
                <Input id="s-start" type="date" value={startDateDraft} onChange={(e) => setStartDateDraft(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-end">Verwachte einddatum</Label>
                <Input id="s-end" type="date" value={endDateDraft} onChange={(e) => setEndDateDraft(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center gap-3 py-1">
              <Switch id="s-public" checked={isPublicDraft} onCheckedChange={setIsPublicDraft} />
              <Label htmlFor="s-public" className="cursor-pointer">Publiek zichtbaar (anderen kunnen volgen)</Label>
            </div>

            <Button
              size="sm"
              onClick={saveBasics}
              disabled={savingBasics}
              className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Check className="h-3.5 w-3.5" /> {savingBasics ? "Opslaan..." : "Opslaan"}
            </Button>
          </div>

          <Separator />

          {/* ── Coverfoto ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Coverfoto</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onOpenCoverPicker();
                onOpenChange(false);
              }}
              className="gap-1.5"
            >
              <ImagePlus className="h-4 w-4" /> Coverfoto kiezen
            </Button>

            {trip?.cover_image_url && (
              <div className="space-y-2 pt-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <MoveVertical className="h-3.5 w-3.5" /> Verticale positie
                </div>
                <Slider
                  value={[coverY]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(v) => onCoverYChange(v[0])}
                  onValueCommit={async (v) => {
                    const { error } = await supabase
                      .from("trips")
                      .update({ cover_position_y: v[0] } as any)
                      .eq("id", trip.id);
                    if (error) toast.error("Kon positie niet opslaan");
                  }}
                />
                <span className="text-xs text-muted-foreground tabular-nums">{coverY}%</span>
              </div>
            )}
          </div>

          <Separator />

          {/* ── Voortgang ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Voortgang</h3>
            {hasEnd && (
              <div className="flex items-center gap-2">
                <Switch
                  id="settings-progress-auto"
                  checked={progressMode === "auto"}
                  onCheckedChange={(c) => persistProgressMode(c ? "auto" : "manual")}
                />
                <Label htmlFor="settings-progress-auto" className="cursor-pointer text-sm">
                  Automatisch op basis van tijdlijn
                </Label>
              </div>
            )}
            {progressMode === "manual" && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Handmatig instellen: {manualVal}%</div>
                <Slider
                  value={[manualVal]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(v) => setManualVal(v[0])}
                  onValueCommit={(v) => persistManual(v[0])}
                />
              </div>
            )}
            {progressMode === "auto" && (
              <p className="text-xs text-muted-foreground">
                Voortgang wordt automatisch berekend op basis van de start- en einddatum.
              </p>
            )}
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}

