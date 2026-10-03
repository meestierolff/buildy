// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookOrderPanel } from "@/components/photobook/BookOrderPanel";
import type { PhotobookDraft } from "@/lib/photobookApi";
const state = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/bookOrdersApi", () => ({ listBookOrders: state.list, createBookOrder: state.create }));
const PROJECT = "20000000-0000-4000-8000-000000000001";
const draft = { version: 3, document: { checksumSha256: "a".repeat(64), pageCount: 5 } } as PhotobookDraft;
const order = { id: "30000000-0000-4000-8000-000000000001", projectId: PROJECT, title: "Testboek", quantity: 1, pageCount: 5, status: "requested", reply: "", version: 1, createdAt: "2026-10-03T10:00:00.000Z" };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><BookOrderPanel projectId={PROJECT} draft={draft} disabled={false} /></QueryClientProvider>);
}
describe("book ordering", () => {
  beforeEach(() => { state.list.mockReset().mockResolvedValue({ items: [] }); state.create.mockReset(); });
  afterEach(cleanup);
  it("reuses the same submission key after a lost response and shows the persisted request", async () => {
    state.create.mockRejectedValueOnce(new Error("Temporary network failure")).mockImplementationOnce(async () => { state.list.mockResolvedValue({ items: [order] }); return { order, replayed: true }; });
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Boek bestellen" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Boek bestellen" }));
    fireEvent.change(screen.getByLabelText("Naam, bezorgadres en contactgegevens"), { target: { value: "Synthetic address and contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Aanvraag versturen" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aanvraag versturen" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Aanvraag versturen" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
    expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1]);
    expect(state.create.mock.calls[0][1]).toMatchObject({ expectedDraftVersion: 3, expectedDocumentSha256: draft.document.checksumSha256, deliveryDetails: "Synthetic address and contact" });
    await waitFor(() => expect(screen.getByText(/Aangevraagd · 1× Bouwboek/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Boek bestellen" })).not.toBeInTheDocument();
  });
  it("shows an admin answer and never exposes a PDF download", async () => {
    state.list.mockResolvedValue({ items: [{ ...order, status: "accepted", reply: "We bevestigen de uitvoering samen." }] });
    mount();
    await waitFor(() => expect(screen.getByText("We bevestigen de uitvoering samen.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /PDF/ })).not.toBeInTheDocument();
  });
});
