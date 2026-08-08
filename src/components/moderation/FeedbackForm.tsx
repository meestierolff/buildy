import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import {
  SUPPORT_PRIVACY_NOTICE_VERSION,
  createFeedbackInputSchema,
  type FeedbackCategory,
} from "../../../shared/contracts/moderation";
import { useSubmitFeedbackMutation } from "@/hooks/useModeration";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const categories: Array<{ value: FeedbackCategory; label: string }> = [
  { value: "bug", label: "Iets werkt niet" },
  { value: "usability", label: "Iets is onduidelijk" },
  { value: "idea", label: "Ik heb een idee" },
  { value: "other", label: "Andere feedback" },
];

export default function FeedbackForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const mutation = useSubmitFeedbackMutation();
  const [category, setCategory] = useState<FeedbackCategory>("usability");
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [commandKey, setCommandKey] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const changed = () => {
    setCommandKey(null);
    setValidationError(null);
  };

  const submit = async () => {
    if (!accepted || mutation.isPending) return;
    const idempotencyKey = commandKey ?? createClientIdempotencyKey("feedback-submit");
    setCommandKey(idempotencyKey);
    const parsed = createFeedbackInputSchema.safeParse({
      idempotencyKey,
      category,
      message,
      route: typeof window === "undefined" ? "/" : window.location.pathname,
      privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      website,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Controleer je feedback.");
      return;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      toast.success("Bedankt voor je feedback");
      onSubmitted?.();
    } catch (error) {
      console.error("Feedback submission failed", error);
      toast.error("Feedback versturen is niet gelukt");
    }
  };

  if (mutation.data) {
    return (
      <div className="border-l-2 border-emerald-600 bg-emerald-500/5 p-5" role="status" aria-live="polite">
        <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
        <h3 className="mt-3 font-semibold">Feedback ontvangen</h3>
        <p className="mt-1 text-sm text-muted-foreground">Dank je. Ontvangstcode: <strong className="text-foreground">{mutation.data.receiptCode}</strong>.</p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="grid gap-4" aria-label="Feedback versturen">
      <div className="grid gap-2">
        <Label htmlFor="feedback-category">Soort feedback</Label>
        <select
          id="feedback-category"
          value={category}
          onChange={(event) => { setCategory(event.target.value as FeedbackCategory); changed(); }}
          className="min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="feedback-message">Wat wil je ons meegeven?</Label>
        <Textarea id="feedback-message" value={message} onChange={(event) => { setMessage(event.target.value); changed(); }} maxLength={5_000} rows={5} placeholder="Beschrijf wat je deed, wat je verwachtte en wat er gebeurde." />
        <p className="text-right text-xs tabular-nums text-muted-foreground">{message.length}/5000</p>
      </div>
      <div className="sr-only" aria-hidden="true">
        <Label htmlFor="feedback-website">Website</Label>
        <Input id="feedback-website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-3 text-sm leading-5">
        <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Ik deel geen gevoelige informatie" />
        <span>Ik deel geen adres, e-mailadres, namen, fotolinks of andere gevoelige informatie in mijn bericht.</span>
      </label>
      {validationError ? <p role="alert" className="text-sm text-destructive">{validationError}</p> : null}
      {mutation.isError ? <p role="alert" className="text-sm text-destructive">Je feedback kon niet worden opgeslagen. Probeer het opnieuw.</p> : null}
      <Button type="submit" className="min-h-11 gap-2" disabled={!accepted || mutation.isPending || message.trim().length < 3}>
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquareText className="h-4 w-4" aria-hidden="true" />}
        {mutation.isPending ? "Versturen…" : "Feedback versturen"}
      </Button>
    </form>
  );
}

