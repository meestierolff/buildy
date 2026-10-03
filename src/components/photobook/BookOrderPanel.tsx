import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { bookOrderStatusLabels, type CreateBookOrderInput } from "../../../shared/contracts/bookOrders";
import { createBookOrder, listBookOrders } from "@/lib/bookOrdersApi";
import type { PhotobookDraft } from "@/lib/photobookApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
export function BookOrderPanel({ projectId, draft, disabled }: { projectId: string; draft: PhotobookDraft; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [delivery, setDelivery] = useState("");
  const attempt = useRef<CreateBookOrderInput | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["book-orders", projectId];
  const orders = useQuery({ queryKey, queryFn: () => listBookOrders(projectId) });
  const mutation = useMutation({ mutationFn: (input: CreateBookOrderInput) => createBookOrder(projectId, input),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); setOpen(false); setDelivery(""); attempt.current = null; toast.success("Je boekaanvraag is ontvangen"); } });
  const activeOrder = orders.data?.items.find(order => !["cancelled", "shipped"].includes(order.status));
  return <section className="mt-5 rounded-xl border bg-card p-4" aria-label="Bouwboek bestellen">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">Je Bouwboek op papier</h3><p className="mt-1 text-sm text-muted-foreground">Vraag je boek aan. Buildy bevestigt de mogelijkheden en prijs voordat er gedrukt wordt.</p></div>
      {!activeOrder && <Button className="min-h-12" disabled={disabled || orders.isPending || orders.isError} onClick={() => setOpen(value => !value)}><BookOpen /> Boek bestellen</Button>}
    </div>
    {orders.isError && <p role="alert" className="mt-3 text-sm text-destructive">Je boekaanvragen konden niet worden geladen. <button type="button" className="underline" onClick={() => void orders.refetch()}>Opnieuw proberen</button></p>}
    {open && !activeOrder && <form className="mt-4 space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (disabled || mutation.isPending) return;
      const body = { expectedDraftVersion: draft.version, expectedDocumentSha256: draft.document.checksumSha256, quantity, deliveryDetails: delivery.trim() };
      if (!attempt.current || JSON.stringify({ ...attempt.current, idempotencyKey: undefined }) !== JSON.stringify(body)) attempt.current = { ...body, idempotencyKey: crypto.randomUUID() };
      try { await mutation.mutateAsync(attempt.current); } catch (error) { toast.error(error instanceof Error ? error.message : "Boekaanvraag mislukt"); }
    }}>
      <div className="space-y-2"><Label htmlFor="book-quantity">Aantal boeken</Label><Input id="book-quantity" type="number" min={1} max={10} value={quantity} onChange={event => setQuantity(Number(event.target.value))} required /></div>
      <div className="space-y-2"><Label htmlFor="book-delivery">Naam, bezorgadres en contactgegevens</Label><Textarea id="book-delivery" value={delivery} minLength={10} maxLength={1500} rows={4} required onChange={event => setDelivery(event.target.value)} placeholder="Naam, straat en huisnummer, postcode, plaats, land. Voeg een telefoonnummer of e-mailadres toe waarop Buildy je kan bereiken." /><p className="text-xs text-muted-foreground">Alleen Buildy ziet deze gegevens voor jouw aanvraag. De status en ons antwoord verschijnen hieronder.</p></div>
      <p className="text-sm">Je vraagt {quantity} {quantity === 1 ? "boek" : "boeken"} aan met {draft.document.pageCount} pagina’s. Deze boekversie wordt vastgelegd. Er vindt nu geen betaling plaats.</p>
      <Button type="submit" disabled={disabled || mutation.isPending}>{mutation.isPending && <Loader2 className="animate-spin" />} Aanvraag versturen</Button>
    </form>}
    {(orders.data?.items ?? []).map(order => <div className="mt-4 border-t pt-3 text-sm" key={order.id}>
      <p className="font-medium">{bookOrderStatusLabels[order.status]} · {order.quantity}× Bouwboek · {order.pageCount} pagina’s</p>
      <p className="mt-1 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("nl-NL")} · aanvraag {order.id.slice(0, 8)}</p>
      {order.reply && <p className="mt-2 whitespace-pre-wrap">{order.reply}</p>}
    </div>)}
  </section>;
}
