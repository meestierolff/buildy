import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { bookOrderStatusLabels, type AdminBookOrder, type BookOrder } from "../../shared/contracts/bookOrders";
import { downloadAdminBookPdf, listAdminBookOrders, updateAdminBookOrder } from "@/lib/bookOrdersApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePageMeta } from "@/hooks/usePageMeta";
function OrderCard({ order, refresh }: { order: AdminBookOrder; refresh: () => void }) {
  const [status, setStatus] = useState(order.status);
  const [reply, setReply] = useState(order.reply);
  const [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); } catch (error) { toast.error(error instanceof Error ? error.message : "Actie mislukt"); } finally { setBusy(false); } };
  return <article className="space-y-4 rounded-xl border bg-card p-5">
    <div><h2 className="text-xl font-semibold">{order.title}</h2><p className="mt-1 text-sm text-muted-foreground">{order.quantity}× · {order.pageCount} pagina’s · {new Date(order.createdAt).toLocaleDateString("nl-NL")} · {order.id.slice(0, 8)}</p></div>
    <p className="whitespace-pre-wrap text-sm">{order.deliveryDetails}</p>
    <p className="text-xs text-muted-foreground">Controleer formaat, afloop en paginavereisten met de drukker vóór verzending. De PDF bevat exact de opgeslagen boekversie.</p>
    <Button disabled={busy || order.status === "cancelled"} variant="outline" onClick={() => void run(() => downloadAdminBookPdf(order.id, order.documentSha256))}>{busy ? <Loader2 className="animate-spin" /> : <Download />} PDF voor drukker maken</Button>
    <div className="space-y-2"><Label htmlFor={`status-${order.id}`}>Status</Label><select className="h-11 w-full rounded-md border bg-background px-3" id={`status-${order.id}`} value={status} onChange={event => setStatus(event.target.value as BookOrder["status"])}>{Object.entries(bookOrderStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
    <div className="space-y-2"><Label htmlFor={`reply-${order.id}`}>Antwoord zichtbaar voor de klant</Label><Textarea id={`reply-${order.id}`} maxLength={1500} value={reply} onChange={event => setReply(event.target.value)} /></div>
    <Button disabled={busy || (status === order.status && reply === order.reply)} onClick={() => void run(async () => { await updateAdminBookOrder(order.id, { expectedVersion: order.version, status, reply }); refresh(); toast.success("Aanvraag bijgewerkt"); })}>Opslaan</Button>
  </article>;
}
export default function BookOrdersAdmin() {
  const [cursor, setCursor] = useState<string | undefined>();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-book-orders", cursor], queryFn: () => listAdminBookOrders(cursor), retry: false });
  usePageMeta({ title: "Boekaanvragen — Buildy", description: "Boekaanvragen beheren", noIndex: true });
  return <main className="container max-w-4xl space-y-5 py-8"><h1 className="text-3xl font-semibold">Boekaanvragen</h1><p className="text-muted-foreground">Bevestig eerst de prijs en uitvoering met de klant. Verstuur de gecontroleerde PDF zelf naar de drukker.</p>
    {query.isPending ? <p role="status">Aanvragen laden…</p> : query.isError ? <p role="alert">Deze beheerpagina is alleen beschikbaar voor bevoegde beheerders, of kan nu niet worden geladen.</p> : <>{query.data.items.length === 0 && <p>Geen boekaanvragen gevonden.</p>}{query.data.items.map(order => <OrderCard key={`${order.id}:${order.version}`} order={order} refresh={() => void client.invalidateQueries({ queryKey: ["admin-book-orders"] })} />)}<div className="flex gap-3">{cursor && <Button variant="outline" onClick={() => setCursor(undefined)}>Nieuwste aanvragen</Button>}{query.data.nextCursor && <Button variant="outline" onClick={() => setCursor(query.data.nextCursor ?? undefined)}>Meer aanvragen</Button>}</div></>}
  </main>;
}
