import {
  useEffect,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type VideoHTMLAttributes,
} from "react";
import { ImageOff, VideoOff } from "lucide-react";

import { cn } from "@/lib/utils";

interface MediaFallbackProps {
  className?: string;
  label: string;
  style?: CSSProperties;
  type: "image" | "video";
}

const MediaFallback = ({ className, label, style, type }: MediaFallbackProps) => {
  const Icon = type === "video" ? VideoOff : ImageOff;
  return (
    <span
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-muted px-3 text-center text-xs font-medium text-muted-foreground",
        className,
      )}
      role="status"
      style={style}
    >
      <Icon className="h-7 w-7 opacity-60" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};

type ResilientImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  fallbackLabel?: string;
  src: string;
};

export const ResilientImage = ({
  fallbackLabel = "Foto niet beschikbaar",
  onError,
  src,
  ...props
}: ResilientImageProps) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <MediaFallback
        className={props.className}
        label={fallbackLabel}
        style={props.style}
        type="image"
      />
    );
  }

  return (
    <img
      {...props}
      src={src}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
};

type ResilientVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  fallbackLabel?: string;
  src: string;
};

export const ResilientVideo = ({
  fallbackLabel = "Video niet beschikbaar",
  onError,
  src,
  ...props
}: ResilientVideoProps) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <MediaFallback
        className={props.className}
        label={fallbackLabel}
        style={props.style}
        type="video"
      />
    );
  }

  return (
    <video
      {...props}
      src={src}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
};
