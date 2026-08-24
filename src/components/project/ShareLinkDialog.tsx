import { useMemo, useRef, useState } from "react";
import { Clock3, Copy, KeyRound, Loader2, RotateCcw, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useCreateProjectShareLink,
  useProjectShareLink,
  useRevokeProjectShareLink,
  useRotateProjectShareLink,
} from "@/hooks/useProjectShares";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";

const EXPIRY_OPTIONS = [
  { days: 1, label: "1 dag" },
  { days: 7, label: "7 dagen" },
  { days: 30, label: "30 dagen" },
] as const;

function expiresAt(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
}

function formattedExpiry(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

type ShareLinkDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopied?: () => void;
  projectId: string;
  projectTitle: string;
};

export function ShareLinkDialog({
  open,
  onOpenChange,
  onCopied,
  projectId,
  projectTitle,
}: ShareLinkDialogProps) {
  const stateQuery = useProjectShareLink(projectId, open);
  const createLink = useCreateProjectShareLink(projectId);
  const rotateLink = useRotateProjectShareLink(projectId);
  const revokeLink = useRevokeProjectShareLink(projectId);
  const [expiryDays, setExpiryDays] = useState("7");
  const [freshShareUrl, setFreshShareUrl] = useState<string | null>(null);
  const issueCommand = useRef<{ expiresAt: string; idempotencyKey: string } | null>(null);
  const revokeKey = useRef<string | null>(null);
  const link = stateQuery.data?.link ?? null;
  const isPending = createLink.isPending || rotateLink.isPending || revokeLink.isPending;
  const linkStatus = useMemo(() => {
    if (!link) return null;
    return link.state === "expired"
      ? `Verlopen op ${formattedExpiry(link.expiresAt)}`
      : `Geldig tot ${formattedExpiry(link.expiresAt)}`;
  }, [link]);

  const forgetFreshSecret = () => {
    setFreshShareUrl(null);
    createLink.reset();
    rotateLink.reset();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return;
    if (!nextOpen) {
      forgetFreshSecret();
      issueCommand.current = null;
      revokeKey.current = null;
    }
    onOpenChange(nextOpen);
  };

  const issue = async () => {
    issueCommand.current ??= {
      expiresAt: expiresAt(Number(expiryDays)),
      idempotencyKey: createClientIdempotencyKey(link ? "project-share-rotate" : "project-share-create"),
    };
    try {
      const base = issueCommand.current;
      const result = link
        ? await rotateLink.mutateAsync({ ...base, expectedVersion: link.version })
        : await createLink.mutateAsync(base);
      setFreshShareUrl(result.shareUrl);
      issueCommand.current = null;
      toast.success(link ? "Nieuwe deellink gemaakt" : "Deellink gemaakt");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Deellink maken lukt nu niet.");
    }
  };

  const copy = async () => {
    if (!freshShareUrl) return;
    try {
      await copyText(freshShareUrl);
      toast.success("Veilige deellink gekopieerd");
      onCopied?.();
    } catch {
      toast.error("Kopiëren lukt niet. Probeer het opnieuw.");
    }
  };

  const revoke = async () => {
    if (!link) return;
    revokeKey.current ??= createClientIdempotencyKey("project-share-revoke");
    try {
      await revokeLink.mutateAsync({
        expectedVersion: link.version,
        idempotencyKey: revokeKey.current,
      });
      revokeKey.current = null;
      forgetFreshSecret();
      toast.success("Deellink ingetrokken");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Deellink intrekken lukt nu niet.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-xl">
        <div className="border-b border-border bg-secondary/55 px-6 py-6 sm:px-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-accent/30 bg-background text-accent">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Deel {projectTitle}</DialogTitle>
            <DialogDescription className="max-w-md leading-relaxed">
              Maak een tijdelijke toegangssleutel. Alleen mensen met deze link kunnen het Verhaal bekijken.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-2">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <p><span className="font-semibold">Alleen kijken.</span> Bewerken en het Bouwboek blijven privé.</p>
            </div>
            <div className="flex gap-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <p><span className="font-semibold">Direct te stoppen.</span> Intrekken of roteren werkt meteen.</p>
            </div>
          </div>

          {stateQuery.isPending ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Deellink controleren…
            </div>
          ) : stateQuery.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4" role="alert">
              <p className="text-sm font-semibold">Deellinkgegevens konden niet worden geladen.</p>
              <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => void stateQuery.refetch()}>
                Opnieuw proberen
              </Button>
            </div>
          ) : (
            <>
              {link ? (
                <div className="rounded-md border border-border bg-background p-4" aria-live="polite">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{link.state === "active" ? "Actieve deellink" : "Verlopen deellink"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{linkStatus}</p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]">
                      {link.state === "active" ? "Actief" : "Verlopen"}
                    </span>
                  </div>
                  {!freshShareUrl ? (
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      Buildy bewaart de geheime link niet. Maak een nieuwe om hem opnieuw te kopiëren; de vorige stopt dan direct.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Er is nog geen actieve deellink. Kies hoe lang de toegang geldig blijft.
                </p>
              )}

              {freshShareUrl ? (
                <div className="rounded-md border-2 border-accent bg-accent/5 p-4" aria-live="polite">
                  <p className="text-sm font-semibold">Je nieuwe link staat klaar</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Kopieer hem nu. Om veiligheidsredenen kan Buildy hem later niet opnieuw tonen.
                  </p>
                  <Button type="button" className="mt-4 min-h-11 w-full gap-2" onClick={() => void copy()}>
                    <Copy className="h-4 w-4" aria-hidden="true" /> Veilige link kopiëren
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="project-share-expiry">Link verloopt na</Label>
                  <Select value={expiryDays} onValueChange={setExpiryDays} disabled={isPending}>
                    <SelectTrigger id="project-share-expiry" className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.days} value={String(option.days)}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" className="min-h-11 w-full gap-2" disabled={isPending} onClick={() => void issue()}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : link ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                    {link ? "Nieuwe link maken" : "Deellink maken"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4 sm:px-8">
          {link ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 gap-2 text-destructive hover:text-destructive"
              disabled={isPending}
              onClick={() => void revoke()}
            >
              <Unlink className="h-4 w-4" aria-hidden="true" /> Link intrekken
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="min-h-11" disabled={isPending} onClick={() => handleOpenChange(false)}>
            Sluiten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
