import type { PhotobookCrop } from "../../../shared/contracts/photobooks";
import { Label } from "@/components/ui/label";

interface PhotobookCropControlsProps {
  crop: PhotobookCrop;
  id: string;
  onChange: (crop: PhotobookCrop) => void;
}

export function PhotobookCropControls({ crop, id, onChange }: PhotobookCropControlsProps) {
  return (
    <div className="space-y-4 pt-3">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Foto passend maken">
        {([
          { value: "contain", label: "Hele foto" },
          { value: "cover", label: "Vlak vullen" },
        ] as const).map((option) => (
          <button
            aria-pressed={crop.fit === option.value}
            className="min-h-11 rounded-lg border border-input px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-[#A94E36] aria-pressed:bg-[#A94E36]/5"
            key={option.value}
            onClick={() => onChange({ ...crop, fit: option.value, zoom: option.value === "contain" ? 1 : crop.zoom })}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {crop.fit === "cover" ? (
        <>
          {([
            { key: "focusX", label: "Positie links / rechts", min: 0, max: 1, step: 0.05 },
            { key: "focusY", label: "Positie boven / onder", min: 0, max: 1, step: 0.05 },
            { key: "zoom", label: "Inzoomen", min: 1, max: 4, step: 0.1 },
          ] as const).map((control) => (
            <div key={control.key}>
              <Label htmlFor={`${id}-${control.key}`} className="text-xs">{control.label}</Label>
              <input
                className="block h-11 w-full cursor-pointer accent-[#A94E36]"
                id={`${id}-${control.key}`}
                max={control.max}
                min={control.min}
                onChange={(event) => onChange({ ...crop, [control.key]: Number(event.target.value) })}
                step={control.step}
                type="range"
                value={crop[control.key]}
              />
            </div>
          ))}
        </>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">Sla op om de uitsnede in je boek te bekijken.</p>
    </div>
  );
}
