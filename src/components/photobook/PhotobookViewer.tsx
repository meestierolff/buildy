import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotobookDocument, PhotobookPage } from "../../../shared/contracts/photobooks";
import { Button } from "@/components/ui/button";
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

function pageName(page: PhotobookPage): string {
  if (page.kind === "cover") return "Cover";
  if (page.id === "digital:opening") return "Voorwoord";
  if (page.id === "digital:closing") return "Tot slot";
  if (page.kind === "photos") return "Foto’s";
  if (page.kind === "update_text") return "Bouwmoment";
  return "Verhaal";
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
    ? `${pageName(visiblePages[0]!)} · ${firstNumber} van ${document.pageCount}`
    : `${firstNumber}–${lastNumber} van ${document.pageCount}`;

  return (
    <section
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      aria-label="Bouwboekweergave"
      className="min-w-0 rounded-2xl border border-[#D8CFC1] bg-[#E9E1D5] p-3 shadow-[0_24px_60px_rgba(38,35,31,0.10)] outline-none focus-visible:ring-2 focus-visible:ring-[#A94E36] dark:border-border dark:bg-muted/50 sm:p-5"
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
      <div className="mb-4 flex items-center justify-center gap-2">
        <Button
          aria-label="Vorige pagina"
          className="rounded-full"
          disabled={current === 0}
          onClick={() => move(-1)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p aria-live="polite" className="min-w-40 text-center text-xs font-semibold tabular-nums text-[#655F57] dark:text-muted-foreground">
          {pageLabel}
        </p>
        <Button
          aria-label="Volgende pagina"
          className="rounded-full"
          disabled={current + visiblePages.length >= document.pageCount}
          onClick={() => move(1)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <p className="sr-only">Gebruik de pijltjestoetsen om te bladeren en Home of End voor het begin of einde.</p>
      <div
        className="overflow-hidden rounded-lg"
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (desktopSpread || start === null) return;
          const end = event.changedTouches[0]?.clientX;
          if (end === undefined || Math.abs(start - end) < 48) return;
          move(start > end ? 1 : -1);
        }}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
      >
        <div
          className={`mx-auto grid max-w-5xl items-start gap-px bg-[#B9AD9D] shadow-[0_22px_46px_rgba(38,35,31,0.24)] ${
            desktopSpread && visiblePages.length > 1 ? "grid-cols-2" : "grid-cols-1"
          }`}
          style={{ width: desktopSpread && visiblePages.length === 1 ? "50%" : "100%" }}
        >
          {visiblePages.map((page) => (
            <div className="min-w-0 bg-white" key={page.id}>
              <CanonicalPhotobookPage document={document} page={page} />
            </div>
          ))}
        </div>
      </div>

      <nav aria-label="Bladzijden" className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {document.pages.slice(0, thumbnailCount).map((page, index) => {
          const active = index >= current && index < current + visiblePages.length;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={`Ga naar ${pageName(page).toLowerCase()}, bladzijde ${page.number}`}
              className="w-24 shrink-0 rounded-md border-2 border-transparent p-1 text-left transition hover:border-[#B9AD9D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-current:border-[#A94E36] aria-current:bg-white/50"
              key={page.id}
              onClick={() => onActivePageChange(normalizedPageIndex(index, document.pageCount, desktopSpread))}
              type="button"
            >
              <div className="overflow-hidden rounded-sm border border-black/10 bg-white shadow-sm">
                <CanonicalPhotobookPage decorative document={document} imageSize="small" page={page} />
              </div>
              <span className="mt-1 block truncate text-center text-[10px] font-medium text-[#655F57] dark:text-muted-foreground">
                {pageName(page)}
              </span>
            </button>
          );
        })}
        {thumbnailCount < document.pageCount ? (
          <button
            className="w-24 shrink-0 rounded-md border border-dashed border-[#B9AD9D] px-2 text-xs text-[#655F57] hover:border-[#A94E36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground"
            onClick={() => setThumbnailCount((count) => Math.min(document.pageCount, count + 10))}
            ref={loadMoreRef}
            type="button"
          >
            Meer tonen
          </button>
        ) : null}
      </nav>
    </section>
  );
};
