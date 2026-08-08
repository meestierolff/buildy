import { useState, type ReactNode } from "react";
import { CheckCircle2, Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  CONTENT_POLICY_VERSION,
  createModerationReportInputSchema,
  MODERATION_REASON_LABELS,
  moderationReasonSchema,
  type ModerationReason,
  type ModerationTargetType,
} from "../../../shared/contracts/moderation";
import { useSubmitModerationReportMutation } from "@/hooks/useModeration";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ReportDialogProps {
  targetType: ModerationTargetType;
  targetId: string;
  targetLabel: string;
  trigger?: ReactNode;
  compact?: boolean;
  onOpenChange?: (open: boolean) => void;
  elevated?: boolean;
}

const reportReasons = moderationReasonSchema.options;

export default function ReportDialog({
  targetType,
  targetId,
  targetLabel,
  trigger,
  compact = false,
  onOpenChange,
  elevated = false,
}: ReportDialogProps) {
  const mutation = useSubmitModerationReportMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ModerationReason>("privacy");
  const [details, setDetails] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [website, setWebsite] = useState("");
  const [commandKey, setCommandKey] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const resetCommand = () => {
    setCommandKey(null);
    setFieldError(null);
  };

  const submit = async () => {
    if (!acceptedPolicy || mutation.isPending) return;
    const idempotencyKey = commandKey ?? createClientIdempotencyKey("moderation-report");
    setCommandKey(idempotencyKey);
    const parsed = createModerationReportInputSchema.safeParse({
      idempotencyKey,
      targetType,
      targetId,
      reason,
      details,
      contactEmail,
      route: typeof window === "undefined" ? "/" : window.location.pathname,
      policyVersion: CONTENT_POLICY_VERSION,
      website,
    });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Controleer de ingevulde gegevens.");
      return;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      toast.success("Je melding is veilig ontvangen");
    } catch (error) {
      console.error("Moderation report submission failed", error);
      toast.error("Melding versturen is niet gelukt");
    }
  };

  const receipt = mutation.data;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size={compact ? "sm" : "default"}
            className="min-h-11 gap-2 text-muted-foreground hover:text-destructive"
          >
            <Flag className="h-4 w-4" aria-hidden="true" /> Melden
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className={`${elevated ? "z-[1301]" : ""} max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl`}
        overlayClassName={elevated ? "z-[1300]" : undefined}
      >
        {receipt ? (
          <div className="py-3 text-center" role="status" aria-live="polite">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
            <DialogHeader className="mt-4 text-center sm:text-center">
              <DialogTitle>Melding ontvangen</DialogTitle>
              <DialogDescription>
                Bewaar ontvangstcode <strong className="text-foreground">{receipt.receiptCode}</strong> als je later contact opneemt.
                {receipt.emailConfirmationQueued ? " Er staat ook een e-mailbevestiging klaar." : " Je hebt geen e-mailadres meegestuurd."}
              </DialogDescription>
            </DialogHeader>
            <Button type="button" className="mt-6 min-h-11" onClick={() => handleOpenChange(false)}>Sluiten</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{targetLabel} melden</DialogTitle>
              <DialogDescription>
                Vertel kort wat er mis is. Bij direct gevaar bel je 112; dit formulier is geen noodkanaal.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`report-reason-${targetId}`}>Reden</Label>
                <select
                  id={`report-reason-${targetId}`}
                  value={reason}
                  onChange={(event) => { setReason(event.target.value as ModerationReason); resetCommand(); }}
                  className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {reportReasons.map((value) => <option key={value} value={value}>{MODERATION_REASON_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`report-details-${targetId}`}>Toelichting <span className="text-muted-foreground">(optioneel)</span></Label>
                <Textarea
                  id={`report-details-${targetId}`}
                  value={details}
                  maxLength={5_000}
                  rows={4}
                  onChange={(event) => { setDetails(event.target.value); resetCommand(); }}
                  placeholder="Beschrijf alleen wat nodig is om de melding te begrijpen."
                />
                <p className="text-right text-xs tabular-nums text-muted-foreground">{details.length}/5000</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`report-email-${targetId}`}>E-mail voor bevestiging <span className="text-muted-foreground">(optioneel)</span></Label>
                <Input
                  id={`report-email-${targetId}`}
                  type="email"
                  autoComplete="email"
                  value={contactEmail}
                  maxLength={254}
                  onChange={(event) => { setContactEmail(event.target.value); resetCommand(); }}
                />
                <p className="text-xs text-muted-foreground">Je e-mailadres wordt versleuteld opgeslagen en staat niet in de moderatie-outbox.</p>
              </div>
              <div className="sr-only" aria-hidden="true">
                <Label htmlFor={`report-website-${targetId}`}>Website</Label>
                <Input id={`report-website-${targetId}`} value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
              </div>
              <label className="flex items-start gap-3 text-sm leading-5">
                <Checkbox
                  checked={acceptedPolicy}
                  onCheckedChange={(checked) => setAcceptedPolicy(checked === true)}
                  aria-label="Ik heb het contentbeleid gelezen"
                />
                <span>Ik heb het <a href="/contentbeleid" className="font-medium text-accent underline underline-offset-2">contentbeleid</a> gelezen en stuur alleen noodzakelijke informatie mee.</span>
              </label>
              {fieldError ? <p className="text-sm text-destructive" role="alert">{fieldError}</p> : null}
              {mutation.isError ? <p className="text-sm text-destructive" role="alert">Je melding kon niet worden vastgelegd. Probeer het later opnieuw.</p> : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => handleOpenChange(false)}>Annuleren</Button>
              <Button type="button" className="min-h-11 gap-2" disabled={!acceptedPolicy || mutation.isPending} onClick={() => void submit()}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Flag className="h-4 w-4" aria-hidden="true" />}
                {mutation.isPending ? "Versturen…" : "Melding versturen"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
