import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
} from "lucide-react";
import type { PhotobookDocument } from "../../../shared/contracts/photobooks";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { normalizedPageIndex } from "@/lib/photobookPreview";
import { CanonicalPhotobookPage } from "./CanonicalPhotobookPage";

function useDesktopSpread(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return desktop;
}

interface PhotobookViewerProps {
  activePage: number;
  document: PhotobookDocument;
  onActivePageChange: (index: number) => void;
}

export const PhotobookViewer = ({
  activePage,
  document,
  onActivePageChange,
}: PhotobookViewerProps) => {
  const desktopSpread = useDesktopSpread();
  const [zoom, setZoom] = useState(100);
  const [thumbnailCount, setThumbnailCount] = useState(10);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const current = normalizedPageIndex(activePage, document.pageCount, desktopSpread);
  const visibleCount = desktopSpread && current > 0 ? 2 : 1;
  const visiblePages = useMemo(
    () => document.pages.slice(current, current + visibleCount),
    [current, document.pages, visibleCount],
  );

  useEffect(() => {
    setThumbnailCount(Math.min(10, document.pageCount));
  }, [document.checksumSha256, document.pageCount]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || thumbnailCount >= document.pageCount || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setThumbnailCount((count) => Math.min(document.pageCount, count + 10));
      }
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [document.pageCount, thumbnailCount]);

  useEffect(() => {
    const normalized = normalizedPageIndex(activePage, document.pageCount, desktopSpread);
    if (normalized !== activePage) onActivePageChange(normalized);
  }, [activePage, desktopSpread, document.pageCount, onActivePageChange]);

  const move = (direction: -1 | 1) => {
    if (!desktopSpread) {
      onActivePageChange(normalizedPageIndex(current + direction, document.pageCount, false));
      return;
    }
    const target = direction === 1
      ? current === 0 ? 1 : current + 2
      : current <= 1 ? 0 : current - 2;
    onActivePageChange(normalizedPageIndex(target, document.pageCount, true));
  };
  const firstNumber = current + 1;
  const lastNumber = Math.min(document.pageCount, current + visiblePages.length);
  const pageLabel = firstNumber === lastNumber
    ? `Pagina ${firstNumber} van ${document.pageCount}`
    : `Pagina's ${firstNumber}–${lastNumber} van ${document.pageCount}`;

  return (
    <section
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      aria-label="Bouwboek printweergave"
      className="min-w-0"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        } else if (event.key === "Home") {
          event.preventDefault();
          onActivePageChange(0);
        } else if (event.key === "End") {
          event.preventDefault();
          onActivePageChange(normalizedPageIndex(document.pageCount - 1, document.pageCount, desktopSpread));
        }
      }}
      tabIndex={0}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            aria-label="Vorige pagina"
            disabled={current === 0}
            onClick={() => move(-1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p aria-live="polite" className="min-w-32 text-center text-xs font-semibold tabular-nums">
            {pageLabel}
          </p>
          <Button
            aria-label="Volgende pagina"
            disabled={current + visiblePages.length >= document.pageCount}
            onClick={() => move(1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-w-56 items-center gap-2">
          <Button
            aria-label="Uitzoomen"
            disabled={zoom <= 50}
            onClick={() => setZoom((value) => Math.max(50, value - 10))}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Minus aria-hidden="true" />
          </Button>
          <Slider
            aria-label="Zoomniveau van het Bouwboek"
            className="w-28"
            max={160}
            min={50}
            onValueChange={([value]) => setZoom(value ?? 100)}
            step={10}
            value={[zoom]}
          />
          <Button
            aria-label="Inzoomen"
            disabled={zoom >= 160}
            onClick={() => setZoom((value) => Math.min(160, value + 10))}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" />
          </Button>
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{zoom}%</span>
        </div>
      </div>

      <p className="sr-only">Gebruik de pijltjestoetsen om te bladeren en Home of End voor het begin of einde.</p>
      <div
        className="overflow-auto rounded-xl border bg-muted/60 p-3 sm:p-5"
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (desktopSpread || zoom > 100 || start === null) return;
          const end = event.changedTouches[0]?.clientX;
          if (end === undefined || Math.abs(start - end) < 48) return;
          move(start > end ? 1 : -1);
        }}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
      >
        <div
          className={`mx-auto grid items-start gap-3 ${
            desktopSpread && visiblePages.length > 1 ? "grid-cols-2" : "grid-cols-1"
          }`}
          style={{ width: `${desktopSpread && visiblePages.length === 1 ? zoom / 2 : zoom}%` }}
        >
          {visiblePages.map((page) => (
            <div className="min-w-0" key={page.id}>
              <div className="overflow-hidden rounded-sm border border-black/10 bg-white shadow-xl">
                <CanonicalPhotobookPage document={document} page={page} />
              </div>
              <p className="mt-2 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
                {page.number}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div aria-label="Paginaminiaturen" className="mt-4 flex gap-2 overflow-x-auto pb-3" role="navigation">
        {document.pages.slice(0, thumbnailCount).map((page, index) => {
          const active = index >= current && index < current + visiblePages.length;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={`Ga naar pagina ${page.number}`}
              className={`w-28 shrink-0 rounded-md border-2 p-1 text-left transition ${
                active ? "border-accent bg-accent/5" : "border-transparent hover:border-border"
              }`}
              key={page.id}
              onClick={() => onActivePageChange(normalizedPageIndex(index, document.pageCount, desktopSpread))}
              type="button"
            >
              <div className="overflow-hidden rounded-sm border bg-white shadow-sm">
                <CanonicalPhotobookPage decorative document={document} imageSize="small" page={page} />
              </div>
              <span className="mt-1 block text-center text-[10px] tabular-nums text-muted-foreground">{page.number}</span>
            </button>
          );
        })}
        {thumbnailCount < document.pageCount && (
          <button
            className="w-28 shrink-0 rounded-md border border-dashed px-3 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
            onClick={() => setThumbnailCount((count) => Math.min(document.pageCount, count + 10))}
            ref={loadMoreRef}
            type="button"
          >
            Meer miniaturen tonen
          </button>
        )}
      </div>
    </section>
  );
};
