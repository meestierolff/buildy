import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Building2,
  Clock3,
  CreditCard,
  Loader2,
  LockKeyhole,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
  Truck,
} from "lucide-react";
import type { ShippingAddress } from "../../../shared/contracts/orders";
import { requestPhotobookQuoteInputSchema } from "../../../shared/contracts/orders";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreatePhotobookCheckout,
  useRequestPhotobookQuote,
} from "@/hooks/useOrders";
import { ApiClientError } from "@/lib/apiClient";
import {
  clearCheckoutIdempotencyKey,
  getOrCreateCheckoutIdempotencyKey,
  stripeCheckoutUrl,
} from "@/lib/orderApi";
import { Link } from "@/lib/router";

const INITIAL_ADDRESS: ShippingAddress = {
  firstName: "",
  lastName: "",
  addressLine1: "",
  addressLine2: null,
  postalCode: "",
  city: "",
  state: null,
  countryCode: "NL",
};

type AddressField = keyof ShippingAddress;
type AddressErrors = Partial<Record<AddressField, string>>;

type CheckoutCommand = {
  key: string;
  signature: string;
};

interface PhotobookCheckoutDialogProps {
  documentSha256: string;
  onCheckoutRedirect?: (url: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pageCount: number;
  pdfSha256: string;
  revisionId: string;
}

function money(minor: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(minor / 100);
}

function quoteError(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function expiryLabel(milliseconds: number): string {
  if (milliseconds <= 0) return "Quote verlopen";
  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes} min ${String(seconds).padStart(2, "0")} sec geldig`
    : `${seconds} sec geldig`;
}

function taxTreatmentLabel(value: "vat_included" | "vat_exclusive" | "vat_exempt"): string {
  if (value === "vat_included") return "BTW inbegrepen in het totaal";
  if (value === "vat_exclusive") return "BTW afzonderlijk opgenomen";
  return "Vrijgesteld van BTW";
}

export const PhotobookCheckoutDialog = ({
  documentSha256,
  onCheckoutRedirect = (url) => window.location.assign(url),
  onOpenChange,
  open,
  pageCount,
  pdfSha256,
  revisionId,
}: PhotobookCheckoutDialogProps) => {
  const quoteMutation = useRequestPhotobookQuote(revisionId);
  const checkoutMutation = useCreatePhotobookCheckout(revisionId);
  const [address, setAddress] = useState<ShippingAddress>(INITIAL_ADDRESS);
  const [quantity, setQuantity] = useState(1);
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [personalisedAccepted, setPersonalisedAccepted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [redirecting, setRedirecting] = useState(false);
  const checkoutCommand = useRef<CheckoutCommand | null>(null);
  const previousOpen = useRef(open);
  const quote = quoteMutation.data;

  const expiryMilliseconds = quote ? Date.parse(quote.expiresAt) - now : 0;
  const quoteExpired = Boolean(quote && expiryMilliseconds <= 0);

  useEffect(() => {
    if (!quote) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  useEffect(() => {
    const wasClosed = previousOpen.current && !open;
    previousOpen.current = open;
    if (!wasClosed) return;
    setActionError(null);
    setAddressErrors({});
    setTermsAccepted(false);
    setPersonalisedAccepted(false);
    setRedirecting(false);
    setAddress(INITIAL_ADDRESS);
    setQuantity(1);
    checkoutCommand.current = null;
    quoteMutation.reset();
    checkoutMutation.reset();
  }, [checkoutMutation, open, quoteMutation]);

  const fieldError = (field: AddressField) => addressErrors[field];
  const describedBy = (field: AddressField) => fieldError(field) ? `checkout-${field}-error` : undefined;

  const setAddressField = (field: AddressField, value: string | null) => {
    setAddress((current) => ({ ...current, [field]: value }));
    setAddressErrors((current) => ({ ...current, [field]: undefined }));
    setActionError(null);
  };

  const selection = useMemo(() => ({
    documentSha256,
    pdfSha256,
    quantity,
    shippingAddress: address,
  }), [address, documentSha256, pdfSha256, quantity]);

  const loadQuote = async (event?: FormEvent) => {
    event?.preventDefault();
    if (quoteMutation.isPending || checkoutMutation.isPending) return;
    const parsed = requestPhotobookQuoteInputSchema.safeParse(selection);
    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      const shippingIssues = parsed.error.issues.filter((issue) => issue.path[0] === "shippingAddress");
      const nextErrors: AddressErrors = {};
      for (const issue of shippingIssues) {
        const field = issue.path[1];
        if (typeof field === "string" && !(field in nextErrors)) {
          nextErrors[field as AddressField] = field === "countryCode"
            ? "Voer een geldige tweeletterige landcode in."
            : "Dit veld is verplicht of ongeldig.";
        }
      }
      setAddressErrors(nextErrors);
      setActionError(flattened.quantity?.[0] ?? "Controleer het afleveradres.");
      return;
    }

    setActionError(null);
    setTermsAccepted(false);
    setPersonalisedAccepted(false);
    setRedirecting(false);
    checkoutCommand.current = null;
    try {
      const nextQuote = await quoteMutation.mutateAsync(parsed.data);
      if (
        nextQuote.proofRevisionId !== revisionId
        || nextQuote.pageCount !== pageCount
        || nextQuote.quantity !== parsed.data.quantity
        || nextQuote.destinationCountry !== parsed.data.shippingAddress.countryCode
      ) {
        quoteMutation.reset();
        throw new Error("De quote kwam niet exact overeen met je bestelling.");
      }
      setNow(Date.now());
    } catch (error) {
      console.error("Photobook quote request failed", error);
      setActionError(quoteError(error, "De exacte prijs kon niet worden opgehaald."));
    }
  };

  const editSelection = () => {
    quoteMutation.reset();
    checkoutMutation.reset();
    setTermsAccepted(false);
    setPersonalisedAccepted(false);
    setActionError(null);
    checkoutCommand.current = null;
  };

  const beginCheckout = async () => {
    if (
      !quote
      || quoteExpired
      || !termsAccepted
      || !personalisedAccepted
      || checkoutMutation.isPending
      || redirecting
    ) return;

    const signature = JSON.stringify({
      revisionId,
      selection,
      quoteReference: quote.quoteReference,
      quoteExpiresAt: quote.expiresAt,
      amounts: quote.amounts,
      termsVersion: quote.termsVersion,
    });
    setActionError(null);
    try {
      if (checkoutCommand.current?.signature !== signature) {
        checkoutCommand.current = {
          signature,
          key: getOrCreateCheckoutIdempotencyKey(revisionId),
        };
      }
      const checkout = await checkoutMutation.mutateAsync({
        ...selection,
        idempotencyKey: checkoutCommand.current!.key,
        expectedQuoteReference: quote.quoteReference,
        expectedQuoteExpiresAt: quote.expiresAt,
        expectedAmounts: quote.amounts,
        termsVersion: quote.termsVersion,
        termsAccepted: true,
        personalisedProductAccepted: true,
      });
      if (
        checkout.proofRevisionId !== revisionId
        || checkout.quantity !== quantity
        || JSON.stringify(checkout.amounts) !== JSON.stringify(quote.amounts)
      ) {
        throw new Error("De checkout kwam niet exact overeen met de bevestigde quote.");
      }
      const checkoutUrl = stripeCheckoutUrl(checkout.checkoutUrl);
      clearCheckoutIdempotencyKey(revisionId);
      checkoutCommand.current = null;
      setRedirecting(true);
      onCheckoutRedirect(checkoutUrl);
    } catch (error) {
      console.error("Photobook checkout creation failed", error);
      if (error instanceof ApiClientError && error.status === 409) {
        clearCheckoutIdempotencyKey(revisionId);
        checkoutCommand.current = null;
        quoteMutation.reset();
        setTermsAccepted(false);
        setPersonalisedAccepted(false);
      }
      setRedirecting(false);
      setActionError(quoteError(error, "De beveiligde betaling kon niet worden gestart."));
    }
  };

  const disabled = quoteMutation.isPending || checkoutMutation.isPending || redirecting;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bouwboek bestellen</DialogTitle>
          <DialogDescription>
            Vraag eerst een exacte, tijdelijke prijs op voor je afleveradres. Betalen start pas na je afzonderlijke bevestiging.
          </DialogDescription>
        </DialogHeader>

        {!quote ? (
          <form className="space-y-5" id="photobook-quote-form" onSubmit={loadQuote}>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-semibold">A4 liggend hardcover</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Exact goedgekeurde proof · {pageCount} pagina’s · revisie {revisionId.slice(0, 8)}
              </p>
            </div>

            <fieldset className="space-y-4" disabled={disabled}>
              <legend className="text-sm font-semibold">Afleveradres</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <AddressInput
                  errors={addressErrors}
                  field="firstName"
                  label="Voornaam"
                  onChange={setAddressField}
                  value={address.firstName}
                />
                <AddressInput
                  errors={addressErrors}
                  field="lastName"
                  label="Achternaam"
                  onChange={setAddressField}
                  value={address.lastName}
                />
              </div>
              <AddressInput
                autoComplete="address-line1"
                errors={addressErrors}
                field="addressLine1"
                label="Straat en huisnummer"
                onChange={setAddressField}
                value={address.addressLine1}
              />
              <AddressInput
                autoComplete="address-line2"
                errors={addressErrors}
                field="addressLine2"
                label="Adresregel 2 (optioneel)"
                onChange={setAddressField}
                value={address.addressLine2 ?? ""}
              />
              <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                <AddressInput
                  autoComplete="postal-code"
                  errors={addressErrors}
                  field="postalCode"
                  label="Postcode"
                  onChange={setAddressField}
                  value={address.postalCode}
                />
                <AddressInput
                  autoComplete="address-level2"
                  errors={addressErrors}
                  field="city"
                  label="Plaats"
                  onChange={setAddressField}
                  value={address.city}
                />
              </div>
              <AddressInput
                autoComplete="address-level1"
                errors={addressErrors}
                field="state"
                label="Provincie/regio (optioneel)"
                onChange={setAddressField}
                value={address.state ?? ""}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-countryCode">Landcode</Label>
                  <Input
                    aria-describedby={describedBy("countryCode") ?? "checkout-country-hint"}
                    aria-invalid={Boolean(fieldError("countryCode"))}
                    autoComplete="country"
                    id="checkout-countryCode"
                    maxLength={2}
                    onChange={(event) => setAddressField("countryCode", event.target.value.toUpperCase())}
                    value={address.countryCode}
                  />
                  <p className="text-[11px] text-muted-foreground" id="checkout-country-hint">ISO-landcode, bijvoorbeeld NL of BE.</p>
                  {fieldError("countryCode") && (
                    <p className="text-xs text-destructive" id="checkout-countryCode-error">Voer een geldige tweeletterige landcode in.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-quantity">Aantal boeken</Label>
                  <Select onValueChange={(value) => setQuantity(Number(value))} value={String(quantity)}>
                    <SelectTrigger id="checkout-quantity"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </fieldset>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Het adres gaat uitsluitend naar de partijen die betaling, druk en bezorging uitvoeren.
            </p>
          </form>
        ) : (
          <div className="space-y-5">
            <div className={`rounded-md border p-3 text-sm ${
              quoteExpired ? "border-destructive/30 bg-destructive/5" : "border-emerald-500/30 bg-emerald-500/5"
            }`} role="status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Exacte quote</p>
                <p className="flex items-center gap-1 text-xs tabular-nums">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {expiryLabel(expiryMilliseconds)}
                </p>
              </div>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{quote.quoteReference}</p>
            </div>

            <section aria-labelledby="quote-price-title" className="rounded-lg border p-4">
              <h3 className="flex items-center gap-2 font-semibold" id="quote-price-title">
                <ReceiptText className="h-4 w-4" aria-hidden="true" /> Prijsopbouw
              </h3>
              <dl className="mt-3 space-y-2 text-sm">
                <PriceRow label={`Bouwboek × ${quote.quantity}`} value={quote.amounts.subtotalMinor} />
                <PriceRow label="Verzending" value={quote.amounts.shippingMinor} />
                <PriceRow
                  label={quote.taxTreatment === "vat_included" ? "Waarvan btw (inbegrepen)" : "BTW"}
                  value={quote.amounts.taxMinor}
                />
                <div className="flex justify-between gap-4 border-t pt-3 text-base font-bold">
                  <dt>Totaal</dt><dd>{money(quote.amounts.totalMinor)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{taxTreatmentLabel(quote.taxTreatment)}</p>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <section aria-labelledby="delivery-title" className="rounded-lg border p-4 text-sm">
                <h3 className="flex items-center gap-2 font-semibold" id="delivery-title">
                  <Truck className="h-4 w-4" aria-hidden="true" /> Bezorging
                </h3>
                <p className="mt-2">{quote.deliveryEstimate}</p>
                <p className="mt-1 text-xs text-muted-foreground">Bestemming: {quote.destinationCountry}</p>
              </section>
              <section aria-labelledby="seller-title" className="rounded-lg border p-4 text-sm">
                <h3 className="flex items-center gap-2 font-semibold" id="seller-title">
                  <Building2 className="h-4 w-4" aria-hidden="true" /> Verkoper
                </h3>
                <address className="mt-2 space-y-1 not-italic text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">{quote.seller.tradeName}</p>
                  <p>{quote.seller.legalName}</p>
                  <p>{quote.seller.address}</p>
                  <p>Registratie: {quote.seller.registrationNumber}</p>
                  {quote.seller.vatNumber && <p>BTW: {quote.seller.vatNumber}</p>}
                  <a className="underline underline-offset-2" href={`mailto:${quote.seller.supportEmail}`}>
                    {quote.seller.supportEmail}
                  </a>
                </address>
              </section>
            </div>

            <p className="rounded-lg border border-amber-700/20 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
              Na de geverifieerde betaling controleert Buildy je Bouwboek en plaatst de
              drukopdracht handmatig. Je volgt de actuele status in Buildy. Vragen kun je
              mailen naar <a className="font-medium underline underline-offset-2" href={`mailto:${quote.seller.supportEmail}`}>{quote.seller.supportEmail}</a>.
            </p>

            <div className="space-y-3 rounded-lg border p-4 text-sm">
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={termsAccepted}
                  id="checkout-terms"
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                />
                <Label className="leading-relaxed" htmlFor="checkout-terms">
                  Ik ga akkoord met de <Link className="underline" to="/voorwaarden">algemene voorwaarden</Link> versie {quote.termsVersion}.
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={personalisedAccepted}
                  id="checkout-personalised"
                  onCheckedChange={(checked) => setPersonalisedAccepted(checked === true)}
                />
                <Label className="leading-relaxed" htmlFor="checkout-personalised">
                  Ik bevestig dat dit Bouwboek volgens mijn specificaties wordt gemaakt en dat voor dit maatwerkproduct de wettelijke uitzondering op het herroepingsrecht geldt.
                </Label>
              </div>
            </div>

            <Button onClick={editSelection} type="button" variant="outline">
              Adres of aantal wijzigen
            </Button>
          </div>
        )}

        {actionError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button disabled={disabled} onClick={() => onOpenChange(false)} type="button" variant="outline">
            Annuleren
          </Button>
          {!quote ? (
            <Button disabled={disabled} form="photobook-quote-form" type="submit">
              {quoteMutation.isPending
                ? <Loader2 className="animate-spin" aria-hidden="true" />
                : <RefreshCcw aria-hidden="true" />}
              Prijs en levering opvragen
            </Button>
          ) : quoteExpired ? (
            <Button disabled={disabled} onClick={() => void loadQuote()} type="button">
              <RefreshCcw aria-hidden="true" /> Nieuwe quote opvragen
            </Button>
          ) : (
            <Button
              disabled={disabled || !termsAccepted || !personalisedAccepted}
              onClick={beginCheckout}
              type="button"
            >
              {checkoutMutation.isPending || redirecting
                ? <Loader2 className="animate-spin" aria-hidden="true" />
                : <CreditCard aria-hidden="true" />}
              Naar beveiligde betaling
            </Button>
          )}
        </DialogFooter>

        {quote && !quoteExpired && (
          <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            De volgende klik maakt de order met exact deze quote aan en stuurt je daarna door naar Stripe Checkout. Een terugkeer van Stripe is nog geen betaalbevestiging.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};

const AddressInput = ({
  autoComplete,
  errors,
  field,
  label,
  onChange,
  value,
}: {
  autoComplete?: string;
  errors: AddressErrors;
  field: AddressField;
  label: string;
  onChange: (field: AddressField, value: string | null) => void;
  value: string;
}) => {
  const error = errors[field];
  const id = `checkout-${field}`;
  const optional = field === "addressLine2" || field === "state";
  const maximumLength: Record<AddressField, number> = {
    firstName: 80,
    lastName: 120,
    addressLine1: 160,
    addressLine2: 160,
    postalCode: 24,
    city: 120,
    state: 120,
    countryCode: 2,
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={Boolean(error)}
        aria-required={!optional}
        autoComplete={autoComplete ?? (field === "firstName" ? "given-name" : field === "lastName" ? "family-name" : undefined)}
        id={id}
        maxLength={maximumLength[field]}
        onChange={(event) => onChange(field, event.target.value || (field === "addressLine2" || field === "state" ? null : ""))}
        value={value}
      />
      {error && <p className="text-xs text-destructive" id={`${id}-error`}>{error}</p>}
    </div>
  );
};

const PriceRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between gap-4">
    <dt className="text-muted-foreground">{label}</dt>
    <dd>{money(value)}</dd>
  </div>
);
