import { useEffect, useId, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { ArrowRight, BookOpen, Camera, Check, ImagePlus, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  isLandingPhotoSupported,
  LANDING_PHOTO_INTENT,
  saveLandingPhotoHandoff,
} from "@/lib/landingPhotoHandoffStore";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link, useNavigate } from "@/lib/router";

const FIRST_MOMENT_INTENT = `${PRODUCT_ROUTES.newProject}?intent=${LANDING_PHOTO_INTENT}`;

export const LOCAL_PHOTO_AUTH_PATH = `/auth?${new URLSearchParams({
  mode: "register",
  provider: "google",
  next: FIRST_MOMENT_INTENT,
}).toString()}`;

interface LocalPhotoDemoProps {
  saveHref?: string;
}

const PreviewImage = ({ src, className = "" }: { src: string; className?: string }) => (
  <img
    src={src}
    alt="Jouw gekozen verbouwfoto in de lokale voorbeeldweergave"
    className={`h-full w-full object-cover ${className}`}
  />
);

const LocalPhotoDemo = ({ saveHref = LOCAL_PHOTO_AUTH_PATH }: LocalPhotoDemoProps) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const choosePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const photo = event.target.files?.[0];
    if (!photo) return;

    if (!isLandingPhotoSupported(photo)) {
      setPreviewUrl(null);
      setSelectedPhoto(null);
      setError("Kies een JPG-, PNG-, WebP-, AVIF-, HEIC- of HEIF-foto van maximaal 50 MB.");
      return;
    }

    setError(null);
    setSelectedPhoto(photo);
    setPreviewUrl(URL.createObjectURL(photo));
  };

  const preservePhoto = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!selectedPhoto || savingPhoto) return;

    setSavingPhoto(true);
    setError(null);
    try {
      await saveLandingPhotoHandoff(selectedPhoto);
      navigate(saveHref);
    } catch (cause) {
      console.error("Preserve landing photo locally failed", cause);
      setError("Deze foto kon niet op dit apparaat worden bewaard. Probeer het opnieuw voordat je verdergaat.");
    } finally {
      setSavingPhoto(false);
    }
  };

  return (
    <section
      id="probeer-buildy"
      aria-labelledby="local-demo-title"
      className="scroll-mt-28 border border-[#D8CFC1] bg-[#FFFDF8]"
    >
      <div className="flex flex-col gap-5 border-b border-[#D8CFC1] px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A94E36]">Probeer het zelf</p>
          <h2 id="local-demo-title" className="mt-2 font-serif text-3xl leading-none text-[#26231F] sm:text-4xl">
            Eén foto. Meteen een verhaal.
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 justify-center border-[#A94E36] bg-transparent px-4 text-[#26231F] hover:bg-[#A94E36] hover:text-white"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          {previewUrl ? "Kies een andere foto" : "Kies een verbouwfoto"}
        </Button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
          className="sr-only"
          aria-label="Kies een verbouwfoto van dit apparaat"
          onChange={choosePhoto}
        />
      </div>

      <div className="flex items-start gap-3 bg-[#F7F2E9] px-4 py-4 text-sm leading-6 text-[#26231F] sm:px-6">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-[#A94E36]" aria-hidden="true" />
        <p>Je foto blijft op dit apparaat totdat je kiest om hem te bewaren. Pas na Google-login en wanneer jij het Bouwmoment plaatst, wordt hij privé geüpload.</p>
      </div>

      {error ? <p className="border-t border-[#D8CFC1] px-4 py-3 text-sm text-destructive sm:px-6" role="alert">{error}</p> : null}

      <div
        className="buildy-proof-strip grid min-w-0 border-t border-[#D8CFC1] sm:grid-cols-2 xl:grid-cols-4"
        aria-live="polite"
      >
        <article className="min-w-0 border-b border-[#D8CFC1] p-4 sm:border-r xl:border-b-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57]">01 · Foto</p>
          <div className="buildy-crop-frame relative mt-3 aspect-[4/3] overflow-hidden bg-[#D8CFC1]">
            {previewUrl ? (
              <PreviewImage src={previewUrl} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[#655F57]">
                <Camera className="h-8 w-8" strokeWidth={1.4} aria-hidden="true" />
                <span className="text-sm">Kies een foto van je apparaat</span>
              </div>
            )}
          </div>
        </article>

        <article className="min-w-0 border-b border-[#D8CFC1] p-4 xl:border-b-0 xl:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57]">02 · Bouwmoment</p>
          <div className="mt-3 border-l-2 border-[#A94E36] pl-3">
            <p className="text-xs font-medium text-[#655F57]">Vandaag</p>
            <p className="mt-1 text-base font-semibold text-[#26231F]">Een Bouwmoment om te bewaren</p>
          </div>
          <div className="mt-4 aspect-[16/9] overflow-hidden bg-[#F7F2E9]">
            {previewUrl ? <PreviewImage src={previewUrl} /> : <div className="h-full w-full" aria-hidden="true" />}
          </div>
        </article>

        <article className="min-w-0 border-b border-[#D8CFC1] p-4 sm:border-b-0 sm:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57]">03 · Verhaal</p>
          <div className="relative mt-4 space-y-4 pl-5 before:absolute before:inset-y-1 before:left-1 before:w-px before:bg-[#D8CFC1]">
            <div className="relative text-sm text-[#655F57] before:absolute before:-left-[1.2rem] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-[#D8CFC1]">
              De verbouwing begint
            </div>
            <div className="relative text-sm font-semibold text-[#26231F] before:absolute before:-left-[1.28rem] before:top-1 before:h-2.5 before:w-2.5 before:rounded-full before:bg-[#A94E36]">
              Jouw Bouwmoment
            </div>
          </div>
          {previewUrl ? (
            <p className="mt-5 flex items-center gap-2 text-sm font-medium text-[#26231F]">
              <Check className="h-4 w-4 text-[#A94E36]" aria-hidden="true" /> Staat op zijn plek
            </p>
          ) : null}
        </article>

        <article className="min-w-0 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#655F57]">04 · Bouwboek</p>
          <div className="buildy-book-binding mt-3 grid aspect-[8/5] grid-cols-2 border border-[#D8CFC1] bg-[#FFFDF8] p-2 shadow-[0_8px_20px_rgba(38,35,31,0.08)]">
            <div className="flex flex-col justify-between border-r border-[#D8CFC1] p-2">
              <BookOpen className="h-4 w-4 text-[#A94E36]" aria-hidden="true" />
              <span className="font-serif text-lg leading-none text-[#26231F]">Ons bouwverhaal</span>
            </div>
            <div className="m-1 overflow-hidden bg-[#D8CFC1]">
              {previewUrl ? <PreviewImage src={previewUrl} /> : <div className="h-full w-full" aria-hidden="true" />}
            </div>
          </div>
        </article>
      </div>

      {previewUrl ? (
        <div className="animate-in fade-in border-t border-[#D8CFC1] px-4 py-5 duration-500 motion-reduce:animate-none sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-6">
          <p className="max-w-xl text-sm leading-6 text-[#655F57]">
            Dit is een lokale voorvertoning. We bewaren de foto alleen op dit apparaat terwijl je inlogt en je privéverbouwing start.
          </p>
          <Button asChild className="mt-4 min-h-11 w-full bg-[#A94E36] text-white hover:bg-[#8F3F2C] sm:mt-0 sm:w-auto">
            <Link
              to={saveHref}
              onClick={(event) => void preservePhoto(event)}
              aria-disabled={savingPhoto}
            >
              {savingPhoto ? "Foto lokaal bewaren…" : "Bewaar dit bouwmoment"} <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
};

export default LocalPhotoDemo;
