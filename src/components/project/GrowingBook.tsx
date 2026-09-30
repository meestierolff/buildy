import { ArrowRight, BookOpen, Check, Loader2 } from "lucide-react";
import { CanonicalPhotobookPage } from "@/components/photobook/CanonicalPhotobookPage";
import { Button } from "@/components/ui/button";
import { usePhotobookDraft } from "@/hooks/usePhotobook";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link } from "@/lib/router";

export default function GrowingBook({ projectId, savedUpdateId }: { projectId: string; savedUpdateId?: string }) {
  const book = usePhotobookDraft(projectId);
  const document = !book.isError && !book.isFetching ? book.data?.document : undefined;
  const page = document?.pages.find((candidate) => candidate.updateId === savedUpdateId)
    ?? document?.pages.find((candidate) => candidate.updateId && candidate.blocks.some((block) => block.type === "photo"))
    ?? document?.pages[0];

  return (
    <section className="border-b border-border bg-secondary/60" aria-labelledby="growing-book-title">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-7 sm:grid-cols-2 sm:items-center sm:px-6 sm:py-10">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent" role={savedUpdateId ? "status" : undefined}>
            {savedUpdateId ? <Check className="h-4 w-4" aria-hidden="true" /> : <BookOpen className="h-4 w-4" aria-hidden="true" />}
            {savedUpdateId ? "Je Bouwmoment is bewaard" : "Jouw Bouwboek"}
          </p>
          <h2 id="growing-book-title" className="font-serif text-3xl leading-tight">Een verhaal om te bewaren.</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {document ? `${document.pageCount} pagina’s van jouw verbouwing. Elk Bouwmoment krijgt een plek.` : "Je foto's en herinneringen groeien samen uit tot een persoonlijk boek."}
          </p>
          <Button asChild variant="outline" className="mt-4 min-h-11 gap-2 bg-background">
            <Link to={PRODUCT_ROUTES.projectPhotobook(projectId)}>Bekijk je Bouwboek <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        </div>
        {document && page ? (
          <Link to={PRODUCT_ROUTES.projectPhotobook(projectId)} aria-label="Blader door je Bouwboek" className="block overflow-hidden rounded-sm border-l-4 border-accent/40 bg-white shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <CanonicalPhotobookPage document={document} page={page} imageSize="medium" decorative />
          </Link>
        ) : (
          <div className="flex aspect-[297/210] items-center justify-center rounded-sm border border-border bg-background text-sm text-muted-foreground" role="status">
            {book.isError ? <span>Open je Bouwboek om opnieuw te laden.</span> : <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Je boek krijgt vorm…</>}
          </div>
        )}
      </div>
    </section>
  );
}
