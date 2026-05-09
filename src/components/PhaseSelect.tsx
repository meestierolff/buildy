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
  customPhases?: string[];
  onAddCustom?: (v: string) => Promise<void> | void;
  placeholder?: string;
}

const PhaseSelect = ({ value, onChange, customPhases = [], onAddCustom, placeholder = "Kies fase" }: Props) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const all = [...DEFAULT_PHASES, ...customPhases.filter((p) => !DEFAULT_PHASES.includes(p))];

  const submitCustom = async () => {
    const v = draft.trim();
    if (!v) return;
    if (onAddCustom) await onAddCustom(v);
    onChange(v);
    setDraft("");
    setAdding(false);
  };

  if (adding) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Naam van eigen fase"
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submitCustom(); }
            if (e.key === "Escape") setAdding(false);
          }}
        />
        <Button type="button" size="sm" onClick={submitCustom}>OK</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>X</Button>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={(v) => v === "__add__" ? setAdding(true) : onChange(v)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="z-[1100] bg-popover"
        sideOffset={4}
      >
        {all.map((p) => (
          <SelectItem key={p} value={p}>{p}</SelectItem>
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
