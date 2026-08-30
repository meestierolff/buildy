import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  SUPPORT_PRIVACY_NOTICE_VERSION,
  createSupportInputSchema,
  type SupportCategory,
  type SupportKind,
} from "../../../shared/contracts/moderation";
import { useSubmitSupportMutation } from "@/hooks/useModeration";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const categories: Array<{ value: SupportCategory; label: string }> = [
  { value: "account", label: "Account of inloggen" },
  { value: "privacy", label: "Privacy of verzoek van een derde" },
  { value: "safety", label: "Veiligheid of misbruik" },
  { value: "technical", label: "Technisch probleem" },
  { value: "content_appeal", label: "Bezwaar over content" },
  { value: "other", label: "Iets anders" },
];

export default function SupportForm({ initialKind = "support" }: { initialKind?: SupportKind }) {
  const mutation = useSubmitSupportMutation();
  const [kind, setKind] = useState<SupportKind>(initialKind);
  const [category, setCategory] = useState<SupportCategory>(initialKind === "appeal" ? "content_appeal" : "other");
  const [contactEmail, setContactEmail] = useState("");
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
    const idempotencyKey = commandKey ?? createClientIdempotencyKey("support-submit");
    setCommandKey(idempotencyKey);
    const parsed = createSupportInputSchema.safeParse({
      idempotencyKey,
      kind,
      category,
      message,
      contactEmail,
      route: typeof window === "undefined" ? "/support" : window.location.pathname,
      privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      website,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Controleer de ingevulde gegevens.");
      return;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      toast.success("Je bericht is veilig ontvangen");
    } catch (error) {
      console.error("Support submission failed", error);
      toast.error("Bericht versturen is niet gelukt");
    }
  };

  if (mutation.data) {
    return (
      <div className="border-l-2 border-emerald-600 bg-emerald-500/5 p-6" role="status" aria-live="polite">
        <CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden="true" />
        <h2 className="mt-3 font-serif text-2xl">Bericht ontvangen</h2>
        <p className="mt-2 text-sm text-muted-foreground">Bewaar ontvangstcode <strong className="text-foreground">{mutation.data.receiptCode}</strong>. Daarmee kun je bij een vervolgcontact naar dit verzoek verwijzen.</p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="grid gap-5" aria-label="Contact met Buildy">
      <div className="grid gap-2">
        <Label htmlFor="support-kind">Soort verzoek</Label>
        <select id="support-kind" value={kind} onChange={(event) => { setKind(event.target.value as SupportKind); changed(); }} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="support">Supportvraag</option>
          <option value="third_party_request">Verzoek over mij of mijn gegevens</option>
          <option value="appeal">Bezwaar tegen een contentbesluit</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="support-category">Onderwerp</Label>
        <select id="support-category" value={category} onChange={(event) => { setCategory(event.target.value as SupportCategory); changed(); }} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="support-email">E-mailadres</Label>
        <Input id="support-email" type="email" autoComplete="email" maxLength={254} required value={contactEmail} onChange={(event) => { setContactEmail(event.target.value); changed(); }} />
        <p className="text-xs text-muted-foreground">Dit adres wordt versleuteld opgeslagen en alleen gebruikt om op dit verzoek te reageren.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="support-message">Je bericht</Label>
        <Textarea id="support-message" required minLength={10} maxLength={5_000} rows={7} value={message} onChange={(event) => { setMessage(event.target.value); changed(); }} placeholder="Geef voldoende context, maar stuur geen wachtwoord, toegangscode of volledige adresgegevens." />
        <p className="text-right text-xs tabular-nums text-muted-foreground">{message.length}/5000</p>
      </div>
      <div className="sr-only" aria-hidden="true">
        <Label htmlFor="support-website">Website</Label>
        <Input id="support-website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-3 text-sm leading-5">
        <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Ik ga akkoord met verwerking voor mijn verzoek" />
        <span>Ik begrijp dat Buildy mijn bericht en contactadres verwerkt om dit verzoek te beoordelen en beantwoorden. Lees de <a href="/privacy" className="font-medium text-accent underline underline-offset-2">privacy-informatie</a>.</span>
      </label>
      {validationError ? <p className="text-sm text-destructive" role="alert">{validationError}</p> : null}
      {mutation.isError ? <p className="text-sm text-destructive" role="alert">Je bericht kon niet worden opgeslagen. Probeer het later opnieuw.</p> : null}
      <Button type="submit" className="min-h-11 gap-2" disabled={!accepted || mutation.isPending || message.trim().length < 10 || !contactEmail.trim()}>
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        {mutation.isPending ? "Veilig versturen…" : "Bericht versturen"}
      </Button>
    </form>
  );
}
