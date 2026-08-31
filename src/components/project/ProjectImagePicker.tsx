import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { Camera, ImagePlus, Upload } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROJECT_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif";

interface ProjectImagePickerProps {
  currentCount: number;
  disabled?: boolean;
  maximumCount?: number;
  onFiles: (files: File[]) => void;
}

const ProjectImagePicker = ({
  currentCount,
  disabled = false,
  maximumCount = 50,
  onFiles,
}: ProjectImagePickerProps) => {
  const cameraInputId = useId();
  const libraryInputId = useId();
  const [dragActive, setDragActive] = useState(false);
  const unavailable = disabled || currentCount >= maximumCount;

  const receiveFiles = (fileList: FileList | null) => {
    if (unavailable || !fileList?.length) return;
    onFiles(Array.from(fileList));
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    receiveFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = unavailable ? "none" : "copy";
    if (!unavailable) setDragActive(true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    receiveFiles(event.dataTransfer.files);
  };

  return (
    <div
      role="group"
      aria-label="Foto's toevoegen"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setDragActive(false);
      }}
      onDrop={handleDrop}
      className={cn(
        "mt-3 border border-dashed bg-secondary/25 px-4 py-5 text-center transition-colors",
        dragActive ? "border-accent bg-accent/10 ring-2 ring-accent/30" : "border-border",
        unavailable && "opacity-60",
      )}
    >
      <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        <label
          htmlFor={cameraInputId}
          aria-disabled={unavailable}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-11 cursor-pointer",
            unavailable && "pointer-events-none cursor-not-allowed",
          )}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Maak een foto
        </label>
        <input
          id={cameraInputId}
          type="file"
          accept={PROJECT_IMAGE_ACCEPT}
          capture="environment"
          className="sr-only"
          aria-label="Maak een foto"
          onChange={handleChange}
          disabled={unavailable}
        />

        <label
          htmlFor={libraryInputId}
          aria-disabled={unavailable}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-11 cursor-pointer",
            unavailable && "pointer-events-none cursor-not-allowed",
          )}
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          Kies uit bibliotheek
        </label>
        <input
          id={libraryInputId}
          type="file"
          multiple
          accept={PROJECT_IMAGE_ACCEPT}
          className="sr-only"
          aria-label="Kies foto's uit je bibliotheek"
          onChange={handleChange}
          disabled={unavailable}
        />
      </div>

      <p className="mt-3 hidden items-center justify-center gap-2 text-xs text-muted-foreground sm:flex">
        <Upload className="h-4 w-4" aria-hidden="true" />
        Of sleep foto&apos;s vanaf je computer naar dit vlak
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        JPG, PNG, WebP, AVIF, HEIC of HEIF · maximaal {maximumCount} per Bouwmoment
      </p>
    </div>
  );
};

export default ProjectImagePicker;
