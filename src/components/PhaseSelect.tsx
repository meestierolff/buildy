import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const DEFAULT_PHASES = [
  "Aankoop",
  "Voorbereiding/Design",
  "Sloop",
  "Ruwbouw",
  "Afbouw",
  "Inrichting",
];

// Tailwind colour class per phase (used for chips, accents).
export const phaseColor = (phase: string | null | undefined) => {
  switch (phase) {
    case "Aankoop": return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "Voorbereiding/Design": return "bg-purple-500/15 text-purple-700 dark:text-purple-300";
    case "Sloop": return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "Ruwbouw": return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "Afbouw": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "Inrichting": return "bg-pink-500/15 text-pink-700 dark:text-pink-300";
    default: return "bg-accent/15 text-accent";
  }
};

interface Props {
  value: string;
  onChange: (v: string) => void;
  options?: ReadonlyArray<{ value: string; label: string }>;
  customPhases?: string[];
  onAddCustom?: (v: string) => Promise<string | void> | string | void;
  placeholder?: string;
  disabled?: boolean;
}

const PhaseSelect = ({
  value,
  onChange,
  options,
  customPhases = [],
  onAddCustom,
  placeholder = "Kies fase",
  disabled = false,
}: Props) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const all = [...DEFAULT_PHASES, ...customPhases.filter((p) => !DEFAULT_PHASES.includes(p))];
  const phaseOptions = options ?? all.map((phase) => ({ value: phase, label: phase }));

  const submitCustom = async () => {
    const v = draft.trim();
    if (!v || savingCustom) return;
    setSavingCustom(true);
    setCustomError(null);
    try {
      const createdValue = onAddCustom ? await onAddCustom(v) : undefined;
      onChange(typeof createdValue === "string" ? createdValue : v);
      setDraft("");
      setAdding(false);
    } catch (error) {
      console.error("Create custom project phase failed", error);
      setCustomError(error instanceof Error ? error.message : "De fase kon niet worden toegevoegd.");
    } finally {
      setSavingCustom(false);
    }
  };

  if (adding) {
    return (
      <div>
        <div className="flex gap-2">
          <Input
            autoFocus
            value={draft}
            maxLength={80}
            disabled={disabled || savingCustom}
            onChange={(e) => { setDraft(e.target.value); setCustomError(null); }}
            placeholder="Naam van eigen fase"
            aria-invalid={Boolean(customError)}
            aria-describedby={customError ? "custom-phase-error" : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void submitCustom(); }
              if (e.key === "Escape" && !savingCustom) setAdding(false);
            }}
          />
          <Button type="button" size="sm" onClick={() => void submitCustom()} disabled={disabled || savingCustom || !draft.trim()}>OK</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={disabled || savingCustom} aria-label="Eigen fase annuleren">X</Button>
        </div>
        {customError && <p id="custom-phase-error" role="alert" className="mt-1 text-xs text-destructive">{customError}</p>}
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={(v) => {
      if (v === "__add__") {
        setCustomError(null);
        setAdding(true);
      } else {
        onChange(v);
      }
    }} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="z-[1100] bg-popover"
        sideOffset={4}
      >
        {phaseOptions.map((phase) => (
          <SelectItem key={phase.value} value={phase.value}>{phase.label}</SelectItem>
        ))}
        {onAddCustom && (
          <SelectItem value="__add__" className="text-accent font-medium">
            <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Eigen fase toevoegen</span>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
};

export default PhaseSelect;
