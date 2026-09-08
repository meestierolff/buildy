// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminOrderDetailSchema,
  adminOrderQueueItemSchema,
  type AdminOrderDetail,
  type ManualFulfilmentAction,
  type ManualFulfilmentStatus,
} from "../../shared/contracts/orders";
import { useAuth } from "@/hooks/useAuth";
import {
  useAdminOrder,
  useAdminOrderActionMutation,
  useInfiniteAdminOrderQueue,
} from "@/hooks/useOrderAdmin";
import { ApiClientError } from "@/lib/apiClient";
import { BrowserRouter, Route, Routes } from "@/lib/router";
import OrderAdmin from "@/pages/OrderAdmin";
import { toast } from "sonner";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useOrderAdmin", () => ({
  useAdminOrder: vi.fn(),
  useAdminOrderActionMutation: vi.fn(),
  useInfiniteAdminOrderQueue: vi.fn(),
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

function restorePrototypeProperty(
  prototype: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(prototype, property, descriptor);
    return;
  }

  Reflect.deleteProperty(prototype, property);
}

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const REVISION_ID = "55555555-5555-4555-8555-555555555555";
const EVENT_ID = "66666666-6666-4666-8666-666666666666";

const queueItem = adminOrderQueueItemSchema.parse({
  orderId: ORDER_ID,
  orderNumber: "BLD-ORDER-0001",
  customerName: "Ada Bouwer",
  projectId: PROJECT_ID,
  projectTitle: "Keuken met daglicht",
  paidAt: "2026-08-20T10:00:00.000Z",
  quantity: 2,
  pageCount: 48,
  currency: "EUR",
  totalMinor: 13_500,
  paymentStatus: "paid",
  fulfilmentStatus: "awaiting_review",
  needsAttention: false,
  version: 7,
});

function orderDetail(
  fulfilmentStatus: ManualFulfilmentStatus = "awaiting_review",
  overrides: Partial<AdminOrderDetail> = {},
): AdminOrderDetail {
  return adminOrderDetailSchema.parse({
    ...queueItem,
    fulfilmentStatus,
    needsAttention: ["manual_review", "refund_review"].includes(fulfilmentStatus),
    ownerId: OWNER_ID,
    customerEmail: "ada@example.test",
    shippingAddress: {
      firstName: "Ada",
      lastName: "Bouwer",
      addressLine1: "Teststraat 1",
      addressLine2: "Niet bezorgen",
      postalCode: "1234 AB",
      city: "Utrecht",
      state: null,
      countryCode: "NL",
    },
    proofRevisionId: REVISION_ID,
    documentSha256: "a".repeat(64),
    pdfSha256: "b".repeat(64),
    amounts: {
      currency: "EUR",
      subtotalMinor: 10_000,
      shippingMinor: 1_000,
      taxMinor: 2_500,
      totalMinor: 13_500,
    },
    refundedMinor: 0,
    manualProviderReference: "DRUK-REF-001",
    fulfilmentNotes: "Controleer de rug voor verzending.",
    trackingUrl: "https://tracking.example.test/pakket/opaque-id",
    seller: {
      legalName: "Buildy test B.V.",
      tradeName: "Buildy",
      registrationNumber: "TEST-12345678",
      vatNumber: null,
      address: "Testadres — niet bezorgen",
      countryCode: "NL",
      supportEmail: "support@example.test",
    },
    stripeReferences: {
      checkoutSessionId: "cs_test_order",
      paymentIntentId: "pi_test_order",
      chargeId: "ch_test_order",
    },
    milestones: {
      reviewedAt: "2026-08-20T10:10:00.000Z",
      orderedManuallyAt: null,
      inProductionAt: null,
      shippedAt: null,
      completedAt: null,
      refundReviewAt: null,
    },
    createdAt: "2026-08-20T09:55:00.000Z",
    updatedAt: "2026-08-20T10:10:00.000Z",
    pdfPath: `/api/admin/orders/${ORDER_ID}/pdf`,
    events: [{
      id: EVENT_ID,
      eventType: "manual_fulfilment_reviewed",
      actorUserId: ADMIN_ID,
      fromStatus: "awaiting_review",
      toStatus: "reviewed",
      occurredAt: "2026-08-20T10:10:00.000Z",
    }],
    ...overrides,
  });
}

function authenticated() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: ADMIN_ID, email: "admin@example.test" },
    loading: false,
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function queueResult(overrides: Record<string, unknown> = {}) {
  vi.mocked(useInfiniteAdminOrderQueue).mockReturnValue({
    data: { pages: [{ items: [], nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useInfiniteAdminOrderQueue>);
}

function detailResult(
  data: AdminOrderDetail | undefined = orderDetail(),
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(useAdminOrder).mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAdminOrder>);
}

function renderPage(path: string) {
  window.history.replaceState(null, "", path);
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/beheer/bestellingen/:orderId" element={<OrderAdmin />} />
        <Route path="/beheer/bestellingen" element={<OrderAdmin />} />
        <Route path="/auth" element={<p>Loginbestemming</p>} />
      </Routes>
    </BrowserRouter>,
  );
}

function openSelect(name: string) {
  const trigger = screen.getByRole("combobox", { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return trigger;
}

async function chooseOption(selectName: string, optionName: string) {
  openSelect(selectName);
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

const ACTIONS_BY_STATUS: Array<{
  status: ManualFulfilmentStatus;
  labels: string[];
}> = [
  {
    status: "awaiting_review",
    labels: [
      "Markeer als gecontroleerd",
      "Werk notitie en referenties bij",
      "Markeer voor handmatige controle",
      "Markeer voor terugbetalingscontrole",
      "Leg annulering vast",
    ],
  },
  {
    status: "reviewed",
    labels: [
      "Leg handmatige bestelling vast",
      "Werk notitie en referenties bij",
      "Markeer voor handmatige controle",
      "Markeer voor terugbetalingscontrole",
      "Leg annulering vast",
    ],
  },
  {
    status: "ordered_manually",
    labels: [
      "Markeer als in productie",
      "Werk notitie en referenties bij",
      "Markeer voor handmatige controle",
      "Markeer voor terugbetalingscontrole",
      "Leg annulering vast",
    ],
  },
  {
    status: "in_production",
    labels: [
      "Markeer als verzonden",
      "Werk notitie en referenties bij",
      "Markeer voor handmatige controle",
      "Markeer voor terugbetalingscontrole",
      "Leg annulering vast",
    ],
  },
  {
    status: "shipped",
    labels: [
      "Markeer als afgerond",
      "Werk notitie en referenties bij",
      "Markeer voor handmatige controle",
      "Markeer voor terugbetalingscontrole",
    ],
  },
  {
    status: "manual_review",
    labels: ["Markeer als gecontroleerd", "Werk notitie en referenties bij", "Leg annulering vast"],
  },
  {
    status: "refund_review",
    labels: ["Markeer als gecontroleerd", "Werk notitie en referenties bij", "Leg annulering vast"],
  },
  {
    status: "completed",
    labels: [
      "Werk notitie en referenties bij",
      "Markeer voor terugbetalingscontrole",
      "Markeer voor handmatige controle",
    ],
  },
  {
    status: "cancelled",
    labels: ["Werk notitie en referenties bij", "Markeer voor terugbetalingscontrole"],
  },
];

const PRIMARY_TRANSITIONS: Array<{
  status: ManualFulfilmentStatus;
  action: ManualFulfilmentAction;
  label: string;
}> = [
  {
    status: "awaiting_review",
    action: "review",
    label: "Markeer als gecontroleerd",
  },
  {
    status: "reviewed",
    action: "ordered_manually",
    label: "Leg handmatige bestelling vast",
  },
  {
    status: "ordered_manually",
    action: "mark_in_production",
    label: "Markeer als in productie",
  },
  {
    status: "in_production",
    action: "mark_shipped",
    label: "Markeer als verzonden",
  },
  {
    status: "shipped",
    action: "mark_completed",
    label: "Markeer als afgerond",
  },
];

describe("OrderAdmin page", () => {
  beforeAll(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => undefined,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authenticated();
    queueResult();
    detailResult();
    vi.mocked(useAdminOrderActionMutation).mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({
        orderId: ORDER_ID,
        fulfilmentStatus: "reviewed",
        version: 8,
        replayed: false,
      }),
    } as unknown as ReturnType<typeof useAdminOrderActionMutation>);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    restorePrototypeProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  });

  it("redirects an anonymous visitor to account login with the exact protected destination", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);

    renderPage(`/beheer/bestellingen/${ORDER_ID}`);

    await waitFor(() => expect(window.location.pathname).toBe("/auth"));
    expect(window.location.search).toBe(
      `?next=${encodeURIComponent(`/beheer/bestellingen/${ORDER_ID}`)}`,
    );
    expect(screen.getByText("Loginbestemming")).toBeInTheDocument();
  });

  it("shows a server-owned non-enumerating denial to an authenticated ordinary user", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: OWNER_ID, email: "bouwer@example.test" },
      loading: false,
      signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    queueResult({
      data: undefined,
      isError: true,
      error: new ApiClientError({
        code: "FORBIDDEN",
        message: "Alleen een beheerder mag deze wachtrij openen.",
        status: 403,
      }),
    });

    renderPage("/beheer/bestellingen");

    expect(screen.getByRole("heading", { name: "Bestellingbeheer niet beschikbaar" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("actief Buildy-beheeraccount");
    expect(screen.queryByRole("button", { name: "Opnieuw proberen" })).not.toBeInTheDocument();
    expect(screen.queryByText("Betaalde Bouwboeken")).not.toBeInTheDocument();
  });

  it("keeps the private PDF action locked when the server denies detail access", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: OWNER_ID, email: "bouwer@example.test" },
      loading: false,
      signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    detailResult(undefined, {
      isError: true,
      error: new ApiClientError({
        code: "FORBIDDEN",
        message: "Alleen een beheerder mag deze bestelling openen.",
        status: 403,
      }),
    });

    renderPage(`/beheer/bestellingen/${ORDER_ID}`);

    expect(screen.getByRole("alert")).toHaveTextContent("actief Buildy-beheeraccount");
    expect(screen.queryByRole("link", { name: "Download print-PDF" })).not.toBeInTheDocument();
    expect(screen.queryByText("ada@example.test")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Opnieuw proberen" })).not.toBeInTheDocument();
  });

  it("renders the admin queue, changes the server filter and paginates", async () => {
    const fetchNextPage = vi.fn();
    queueResult({
      data: { pages: [{ items: [queueItem], nextCursor: "opaque-next" }] },
      hasNextPage: true,
      fetchNextPage,
    });

    renderPage("/beheer/bestellingen");

    expect(screen.getByRole("heading", { name: "Betaalde Bouwboeken" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /BLD-ORDER-0001/ });
    expect(within(row).getByText("Ada Bouwer")).toBeInTheDocument();
    expect(within(row).getByText("Keuken met daglicht")).toBeInTheDocument();
    expect(within(row).getByText(/€\s*135,00/)).toBeInTheDocument();
    expect(within(row).getByText("Te controleren")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "BLD-ORDER-0001" })).toHaveAttribute(
      "href",
      `/beheer/bestellingen/${ORDER_ID}`,
    );

    await chooseOption("Status", "Handmatige aandacht");
    await waitFor(() => expect(useInfiniteAdminOrderQueue).toHaveBeenLastCalledWith({
      status: "manual_review",
      limit: 30,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Meer bestellingen" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it("renders loading, empty and retryable queue states", () => {
    queueResult({ data: undefined, isPending: true });
    const view = renderPage("/beheer/bestellingen");
    expect(screen.getByRole("status")).toHaveTextContent("Bestellingen laden");

    queueResult();
    view.rerender(
      <BrowserRouter>
        <Routes><Route path="/beheer/bestellingen" element={<OrderAdmin />} /></Routes>
      </BrowserRouter>,
    );
    expect(screen.getByRole("heading", { name: "Geen bestellingen in deze status" })).toBeInTheDocument();

    const refetch = vi.fn();
    queueResult({
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiClientError({ code: "INTERNAL_ERROR", message: "Tijdelijk mislukt.", status: 503 }),
      refetch,
    });
    view.rerender(
      <BrowserRouter>
        <Routes><Route path="/beheer/bestellingen" element={<OrderAdmin />} /></Routes>
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders locked proof, customer data, current status and audit history on detail", () => {
    detailResult(orderDetail("manual_review"));

    renderPage(`/beheer/bestellingen/${ORDER_ID}`);

    expect(screen.getByRole("heading", { name: "Keuken met daglicht" })).toBeInTheDocument();
    expect(screen.getByText("Handmatige aandacht")).toBeInTheDocument();
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
    expect(screen.getByText("1234 AB Utrecht")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("b".repeat(64))).toBeInTheDocument();
    const pdf = screen.getByRole("link", { name: "Download print-PDF" });
    expect(pdf).toHaveAttribute("href", `/api/admin/orders/${ORDER_ID}/pdf`);
    expect(pdf).not.toHaveAttribute("target");

    const history = screen.getByRole("heading", { name: "Auditgeschiedenis" }).closest("section");
    expect(history).not.toBeNull();
    expect(within(history!).getByText("manual fulfilment reviewed")).toBeInTheDocument();
    expect(within(history!).getByText(/awaiting_review → reviewed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Externe drukkerreferentie")).toHaveValue("DRUK-REF-001");
    expect(screen.getByLabelText("Trackinglink")).toHaveValue(
      "https://tracking.example.test/pakket/opaque-id",
    );
    expect(screen.getByLabelText("Interne notitie")).toHaveValue(
      "Controleer de rug voor verzending.",
    );
  });

  it.each(ACTIONS_BY_STATUS)(
    "offers only the visible $status transitions",
    async ({ status, labels }) => {
      detailResult(orderDetail(status));
      renderPage(`/beheer/bestellingen/${ORDER_ID}`);

      openSelect("Actie");
      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual(labels);
    },
  );

  it.each(PRIMARY_TRANSITIONS)(
    "submits $action from $status with the current optimistic-lock version",
    async ({ status, action, label }) => {
      const mutateAsync = vi.fn().mockResolvedValue({
        orderId: ORDER_ID,
        fulfilmentStatus: status,
        version: 8,
        replayed: false,
      });
      vi.mocked(useAdminOrderActionMutation).mockReturnValue({
        isPending: false,
        mutateAsync,
      } as unknown as ReturnType<typeof useAdminOrderActionMutation>);
      detailResult(orderDetail(status));
      renderPage(`/beheer/bestellingen/${ORDER_ID}`);

      fireEvent.click(await screen.findByRole("button", { name: label }));

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        action,
        expectedVersion: 7,
      }));
      expect(toast.success).toHaveBeenCalledWith(label);
    },
  );

  it("requires an external reference before recording a manual order", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      orderId: ORDER_ID,
      fulfilmentStatus: "ordered_manually",
      version: 8,
      replayed: false,
    });
    vi.mocked(useAdminOrderActionMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useAdminOrderActionMutation>);
    detailResult(orderDetail("reviewed", { manualProviderReference: null }));
    renderPage(`/beheer/bestellingen/${ORDER_ID}`);

    const submit = await screen.findByRole("button", { name: "Leg handmatige bestelling vast" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Vul de externe referentie in");

    fireEvent.change(screen.getByLabelText("Externe drukkerreferentie"), {
      target: { value: "  DRUK-2026-42  " },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      action: "ordered_manually",
      expectedVersion: 7,
      externalReference: "DRUK-2026-42",
    }));
  });

  it("submits trimmed reference, HTTPS tracking and notes through one typed action", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      orderId: ORDER_ID,
      fulfilmentStatus: "completed",
      version: 8,
      replayed: false,
    });
    vi.mocked(useAdminOrderActionMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useAdminOrderActionMutation>);
    detailResult(orderDetail("completed"));
    renderPage(`/beheer/bestellingen/${ORDER_ID}`);

    fireEvent.change(screen.getByLabelText("Externe drukkerreferentie"), {
      target: { value: "  DRUK-UPDATED  " },
    });
    fireEvent.change(screen.getByLabelText("Trackinglink"), {
      target: { value: "  https://tracking.example.test/nieuw  " },
    });
    fireEvent.change(screen.getByLabelText("Interne notitie"), {
      target: { value: "  Afgeleverd bij de klant.  " },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Werk notitie en referenties bij" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "update_details",
      expectedVersion: 7,
      externalReference: "DRUK-UPDATED",
      trackingUrl: "https://tracking.example.test/nieuw",
      notes: "Afgeleverd bij de klant.",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(toast.success).toHaveBeenCalledWith("Werk notitie en referenties bij");
  });

  it("submits secondary manual-review, refund-review and cancellation actions", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      orderId: ORDER_ID,
      fulfilmentStatus: "manual_review",
      version: 8,
      replayed: false,
    });
    vi.mocked(useAdminOrderActionMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useAdminOrderActionMutation>);
    detailResult(orderDetail("awaiting_review"));
    renderPage(`/beheer/bestellingen/${ORDER_ID}`);

    for (const [label, action] of [
      ["Markeer voor handmatige controle", "manual_review"],
      ["Markeer voor terugbetalingscontrole", "refund_review"],
      ["Leg annulering vast", "cancel"],
    ] as const) {
      await chooseOption("Actie", label);
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(
        action === "manual_review" ? 1 : action === "refund_review" ? 2 : 3,
      ));
      expect(mutateAsync.mock.calls.at(-1)?.[0]).toMatchObject({ action, expectedVersion: 7 });
    }
  });

  it("shows a safe mutation error and retries a failed detail load", async () => {
    const detailRefetch = vi.fn();
    detailResult(undefined, {
      data: undefined,
      isError: true,
      error: new ApiClientError({
        code: "INTERNAL_ERROR",
        message: "Bestelling tijdelijk niet beschikbaar.",
        status: 503,
      }),
      refetch: detailRefetch,
    });
    const view = renderPage(`/beheer/bestellingen/${ORDER_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    expect(detailRefetch).toHaveBeenCalledOnce();

    const mutateAsync = vi.fn().mockRejectedValue(new ApiClientError({
      code: "VALIDATION_FAILED",
      message: "De trackinglink moet HTTPS gebruiken.",
      status: 400,
    }));
    vi.mocked(useAdminOrderActionMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useAdminOrderActionMutation>);
    detailResult(orderDetail());
    view.rerender(
      <BrowserRouter>
        <Routes><Route path="/beheer/bestellingen/:orderId" element={<OrderAdmin />} /></Routes>
      </BrowserRouter>,
    );
    fireEvent.change(screen.getByLabelText("Trackinglink"), {
      target: { value: "http://onveilig.example.test/pakket" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Markeer als gecontroleerd" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "De trackinglink moet HTTPS gebruiken.",
    ));
  });
});
