import { useEffect, useMemo, useState } from "react";
import { FileCheck2, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  loadPhotobookProofView,
  type LoadedPhotobookProof,
} from "@/lib/photobookApi";

type PhotobookProofViewerProps = {
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
  pageCount: number;
  thumbnailPaths: readonly string[];
  onViewed: (proof: LoadedPhotobookProof | null) => void;
};

type ProofLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; objectUrl: string; proof: LoadedPhotobookProof };

export function PhotobookProofViewer({
  revisionId,
  documentSha256,
  pdfSha256,
  pageCount,
  thumbnailPaths,
  onViewed,
}: PhotobookProofViewerProps) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ProofLoadState>({ status: "loading" });
  const proofKey = useMemo(
    () => `${revisionId}:${documentSha256}:${pdfSha256}`,
    [documentSha256, pdfSha256, revisionId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    onViewed(null);
    setState({ status: "loading" });

    void loadPhotobookProofView({
      revisionId,
      documentSha256,
      pdfSha256,
      signal: controller.signal,
    }).then((proof) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(proof.blob);
      setState({ status: "ready", objectUrl, proof });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.error("Photobook proof view failed", error);
      setState({ status: "error" });
    });

    return () => {
      controller.abort();
      onViewed(null);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentSha256, onViewed, pdfSha256, proofKey, reload, revisionId]);

  return (
    <section aria-labelledby="real-proof-title" className="mb-6 overflow-hidden rounded-xl border border-emerald-500/30 bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-emerald-500/10 px-4 py-3 sm:px-5">
        <div>
          <p className="eyebrow">Private PDF · revisie {revisionId.slice(0, 8)}</p>
          <h2 className="mt-1 flex items-center gap-2 font-serif text-2xl" id="real-proof-title">
            <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            Echte printproof
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Dit zijn de checksum-gecontroleerde PDF-bytes die voor deze revisie zijn opgebouwd.
          </p>
        </div>
        <span className="rounded-full border bg-background px-2.5 py-1 text-xs tabular-nums">
          {pageCount} pagina’s
        </span>
      </div>

      {state.status === "loading" && (
        <div className="flex min-h-80 items-center justify-center gap-2 p-6 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Private printproof laden en checksum controleren…
        </div>
      )}

      {state.status === "error" && (
        <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
          <FileCheck2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="max-w-md text-sm">
            De actuele PDF-proof kon niet volledig en veilig worden geladen. Goedkeuren blijft geblokkeerd.
          </p>
          <Button onClick={() => setReload((value) => value + 1)} type="button" variant="outline">
            <RefreshCcw aria-hidden="true" /> Opnieuw laden
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <iframe
          className="h-[70vh] min-h-[560px] w-full bg-white"
          data-proof-key={proofKey}
          onLoad={() => onViewed(state.proof)}
          src={`${state.objectUrl}#toolbar=0&navpanes=0`}
          title={`Printproof van ${pageCount} pagina's`}
        />
      )}

      <div className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
        {thumbnailPaths.length === 0
          ? "Er zijn geen afgeleide thumbnails nodig: je bekijkt de private canonical PDF rechtstreeks."
          : "De PDF blijft leidend; afgeleide thumbnails worden niet als goedkeuringsbewijs gebruikt."}
      </div>
    </section>
  );
}
