import { useId, useState } from "react";
import { CheckCircle2, Loader2, MessageSquareText, Star } from "lucide-react";
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

export type FeedbackIntent = "general" | "print-interest";

export type StructuredFeedback = {
  workedWell: string;
  unclear: string;
  missing: string;
  rating: number | null;
};

const ANSWER_MAX_LENGTH = 1_400;

function answerOrDash(value: string): string {
  return value.trim() || "—";
}

export function serializeStructuredFeedback(
  feedback: StructuredFeedback,
  intent: FeedbackIntent,
): string {
  return [
    "Buildy-feedback v1",
    `Context: ${intent === "print-interest" ? "Interesse in later laten drukken" : "Algemene productfeedback"}`,
    `Waardering: ${feedback.rating === null ? "Niet ingevuld" : `${feedback.rating}/5`}`,
    "",
    "Wat werkte goed?",
    answerOrDash(feedback.workedWell),
    "",
    "Wat was onduidelijk?",
    answerOrDash(feedback.unclear),
    "",
    "Wat mis je?",
    answerOrDash(feedback.missing),
  ].join("\n");
}

function feedbackCategory(feedback: StructuredFeedback, intent: FeedbackIntent): FeedbackCategory {
  if (intent === "print-interest" || feedback.missing.trim()) return "idea";
  if (feedback.unclear.trim()) return "usability";
  return "other";
}

type FeedbackFormProps = {
  intent?: FeedbackIntent;
  onSubmitted?: () => void;
};

export default function FeedbackForm({
  intent = "general",
  onSubmitted,
}: FeedbackFormProps) {
  const mutation = useSubmitFeedbackMutation();
  const fieldId = useId();
  const [workedWell, setWorkedWell] = useState("");
  const [unclear, setUnclear] = useState("");
  const [missing, setMissing] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [commandKey, setCommandKey] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const changed = () => {
    setCommandKey(null);
    setValidationError(null);
  };

  const feedback = { workedWell, unclear, missing, rating } satisfies StructuredFeedback;
  const hasAnswer = [workedWell, unclear, missing].some((answer) => answer.trim().length >= 3);
  const canSubmit = accepted && (intent === "print-interest" || hasAnswer);

  const submit = async () => {
    if (!canSubmit || mutation.isPending) return;
    const idempotencyKey = commandKey ?? createClientIdempotencyKey("feedback-submit");
    setCommandKey(idempotencyKey);
    const parsed = createFeedbackInputSchema.safeParse({
      idempotencyKey,
      category: feedbackCategory(feedback, intent),
      message: serializeStructuredFeedback(feedback, intent),
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
      toast.success(intent === "print-interest" ? "Je interesse is gedeeld" : "Bedankt voor je feedback");
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
        <h3 className="mt-3 font-semibold">
          {intent === "print-interest" ? "Interesse ontvangen" : "Feedback ontvangen"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Dank je. Ontvangstcode: <strong className="text-foreground">{mutation.data.receiptCode}</strong>.
        </p>
      </div>
    );
  }

  const fields = [
    {
      id: `${fieldId}-worked-well`,
      label: "Wat werkte goed?",
      placeholder: "Bijvoorbeeld: ik zag meteen hoe mijn verhaal groeit.",
      value: workedWell,
      setValue: setWorkedWell,
    },
    {
      id: `${fieldId}-unclear`,
      label: "Wat was onduidelijk?",
      placeholder: "Waar moest je even zoeken of twijfelen?",
      value: unclear,
      setValue: setUnclear,
    },
    {
      id: `${fieldId}-missing`,
      label: "Wat mis je?",
      placeholder: intent === "print-interest"
        ? "Wat zou belangrijk zijn in een gedrukt Bouwboek?"
        : "Welke kleine verbetering zou het verschil maken?",
      value: missing,
      setValue: setMissing,
    },
  ];

  return (
    <form
      aria-label={intent === "print-interest" ? "Interesse in een gedrukt Bouwboek delen" : "Feedback versturen"}
      className="grid gap-4"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      {fields.map((field) => (
        <div className="grid gap-1.5" key={field.id}>
          <Label htmlFor={field.id}>{field.label}</Label>
          <Textarea
            id={field.id}
            maxLength={ANSWER_MAX_LENGTH}
            onChange={(event) => { field.setValue(event.target.value); changed(); }}
            placeholder={field.placeholder}
            rows={2}
            value={field.value}
          />
        </div>
      ))}

      <fieldset>
        <legend className="text-sm font-medium">Hoe voelt Buildy tot nu toe? <span className="font-normal text-muted-foreground">(optioneel)</span></legend>
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Waardering van 1 tot 5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              aria-label={`${value} van 5`}
              aria-pressed={rating === value}
              className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent/10 aria-pressed:text-accent"
              key={value}
              onClick={() => { setRating((current) => current === value ? null : value); changed(); }}
              type="button"
            >
              <Star className="h-5 w-5" fill={rating !== null && value <= rating ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="sr-only" aria-hidden="true">
        <Label htmlFor={`${fieldId}-website`}>Website</Label>
        <Input
          autoComplete="off"
          id={`${fieldId}-website`}
          onChange={(event) => setWebsite(event.target.value)}
          tabIndex={-1}
          value={website}
        />
      </div>

      <label className="flex items-start gap-3 text-xs leading-5 text-muted-foreground">
        <Checkbox
          aria-label="Ik deel geen gevoelige informatie"
          checked={accepted}
          onCheckedChange={(value) => setAccepted(value === true)}
        />
        <span>Ik deel geen adres, e-mailadres, namen, fotolinks of andere gevoelige informatie.</span>
      </label>
      {!hasAnswer && intent === "general" ? (
        <p className="text-xs text-muted-foreground">Beantwoord minimaal één vraag om je feedback te versturen.</p>
      ) : null}
      {validationError ? <p role="alert" className="text-sm text-destructive">{validationError}</p> : null}
      {mutation.isError ? <p role="alert" className="text-sm text-destructive">Je feedback kon niet worden opgeslagen. Probeer het opnieuw.</p> : null}
      <Button type="submit" className="min-h-11 gap-2" disabled={!canSubmit || mutation.isPending}>
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquareText className="h-4 w-4" aria-hidden="true" />}
        {mutation.isPending
          ? "Versturen…"
          : intent === "print-interest" ? "Interesse delen" : "Feedback versturen"}
      </Button>
    </form>
  );
}
