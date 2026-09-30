import { ArrowRight, BookOpen, Check, Loader2 } from "lucide-react";
import { CanonicalPhotobookPage } from "@/components/photobook/CanonicalPhotobookPage";
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
    <section className="mx-auto max-w-3xl px-4 pt-5 sm:px-6" aria-labelledby="growing-book-title">
      <Link to={PRODUCT_ROUTES.projectPhotobook(projectId)} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40">
        <div className="w-20 shrink-0 overflow-hidden rounded-sm border-l-[3px] border-primary/50 bg-secondary shadow-sm" aria-hidden="true">
          {document && page ? <CanonicalPhotobookPage document={document} page={page} imageSize="medium" decorative /> : <div className="flex aspect-[297/210] items-center justify-center text-primary">{book.isFetching ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookOpen className="h-6 w-6" />}</div>}
        </div>
        <div className="min-w-0 flex-1">
          {savedUpdateId ? <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-primary" role="status"><Check className="h-3 w-3" aria-hidden="true" /> Je Bouwmoment is bewaard</p> : null}
          <h2 id="growing-book-title" className="text-sm font-semibold">Je Bouwboek groeit mee</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{document ? `${document.pageCount} pagina’s · automatisch samengesteld` : book.isError ? "Open je Bouwboek om opnieuw te laden." : "Je foto’s worden een persoonlijk boek."}</p>
          <span className="mt-1 block text-xs font-semibold text-primary">Bekijk je Bouwboek</span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      </Link>
    </section>
  );
}
