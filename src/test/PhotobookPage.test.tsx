// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PhotobookDocument,
  PhotobookPage,
  PhotobookSettings,
} from "../../shared/contracts/photobooks";
import type { PhotobookDraft } from "@/lib/photobookApi";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

const state = vi.hoisted(() => ({
  draft: undefined as PhotobookDraft | undefined,
  navigate: vi.fn(),
  refetch: vi.fn(),
  requestProof: vi.fn(),
  loadProof: vi.fn(),
  createObjectUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: { id: "owner" } }),
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/usePhotobook", () => ({
  usePhotobookDraft: () => ({
    data: state.draft,
    isError: false,
    isPending: false,
    refetch: state.refetch,
  }),
  useReplacePhotobookExclusions: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdatePhotobookSettings: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRequestPhotobookProof: () => ({
    isPending: false,
    mutateAsync: state.requestProof,
  }),
}));
vi.mock("@/lib/photobookApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/photobookApi")>(),
  createPhotobookIdempotencyKey: () => "55555555-5555-4555-8555-555555555555",
  loadPhotobookProofView: state.loadProof,
}));
vi.mock("@/lib/betaApi", () => ({
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/router", () => ({
  useNavigate: () => state.navigate,
  useParams: () => ({ id: PROJECT_ID }),
  Link: ({ to, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    children?: ReactNode;
  }) => <a href={to} {...props}>{children}</a>,
}));

import Photobook from "@/pages/Photobook";

function cover(): PhotobookPage {
  return {
    id: "cover",
    number: 1,
    kind: "cover",
    chapterId: null,
    updateId: null,
    background: "#142238",
    overlay: null,
    blocks: [],
  };
}

function updatePage(): PhotobookPage {
  return {
    id: `update:${UPDATE_ID}:text:1`,
    number: 2,
    kind: "update_text",
    chapterId: "chapter:test",
    updateId: UPDATE_ID,
    background: "#ffffff",
    overlay: null,
    blocks: [
      {
        id: `update:${UPDATE_ID}:date:0`,
        type: "text",
        frame: { xMm: 12, yMm: 18, widthMm: 273, heightMm: 8 },
        font: "inter",
        weight: "regular",
        style: "normal",
        fontSizePt: 8,
        lineHeightPt: 10,
        align: "left",
        color: "#777777",
        text: "29 augustus 2026",
        lines: ["29 augustus 2026"],
      },
      {
        id: `update:${UPDATE_ID}:title`,
        type: "text",
        frame: { xMm: 12, yMm: 37, widthMm: 273, heightMm: 24 },
        font: "instrument-serif",
        weight: "semibold",
        style: "normal",
        fontSizePt: 22,
        lineHeightPt: 25,
        align: "left",
        color: "#171717",
        text: "De eerste muur",
        lines: ["De eerste muur"],
      },
    ],
  };
}

function documentWith(pages: PhotobookPage[]): PhotobookDocument {
  return {
    version: 1,
    projectId: PROJECT_ID,
    projectRevision: 1,
    selectedFormat: "a4-landscape-hardcover-v1",
    locale: "nl-NL",
    print: {
      widthMm: 297,
      heightMm: 210,
      safeMarginMm: 12,
      bleedMm: 0,
      targetDpi: 300,
      colorSpace: "RGB",
    },
    cover: { title: "Ons klushuis", subtitle: "", mediaAssetId: null, crop: null },
    chapters: [],
    pages,
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: pages.length,
    warnings: [],
    checksumSha256: "a".repeat(64),
  };
}

const settings: PhotobookSettings = {
  coverMediaAssetId: null,
  selectedFormat: "a4-landscape-hardcover-v1",
  title: null,
  subtitle: null,
  includeBudget: false,
  preferences: {
    coverCrop: null,
    cropByAsset: {},
    photoOrderByUpdate: {},
    layoutByPage: {},
  },
  version: 1,
};

function draftWith(pages: PhotobookPage[]): PhotobookDraft {
  return {
    draftId: "33333333-3333-4333-8333-333333333333",
    version: 1,
    settings,
    exclusions: [],
    document: documentWith(pages),
    proof: null,
  };
}

function readyProof(document: PhotobookDocument): NonNullable<PhotobookDraft["proof"]> {
  return {
    revisionId: REVISION_ID,
    status: "ready",
    documentSha256: document.checksumSha256,
    pdfSha256: "b".repeat(64),
    pageCount: document.pageCount,
    pdfPath: `/api/photobooks/proofs/${REVISION_ID}/pdf`,
    thumbnailPaths: [],
  };
}

describe("Bouwboekpagina", () => {
  beforeEach(() => {
    state.navigate.mockReset();
    state.refetch.mockReset().mockImplementation(async () => ({ data: state.draft }));
    state.requestProof.mockReset();
    state.loadProof.mockReset().mockResolvedValue({ blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }) });
    state.createObjectUrl.mockReset().mockReturnValue("blob:buildy-pdf");
    state.revokeObjectUrl.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: state.createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: state.revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("toont een waarheidsgetrouwe lege staat zonder fictief gevuld boek", () => {
    state.draft = draftWith([cover()]);
    render(<Photobook />);

    expect(screen.getByRole("heading", {
      name: "Je Bouwboek groeit met je verbouwing mee",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: "Je eerste bladzijde begint met een Bouwmoment",
    })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Bouwboekweergave" })).not.toBeInTheDocument();
  });

  it("biedt alleen de digitale verhaalflow, twee indelingen en de interesseactie", () => {
    state.draft = draftWith([cover(), updatePage()]);
    render(<Photobook />);

    expect(screen.getByRole("region", { name: "Bouwboekweergave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bouwmoment, bladzijde 2/i })).toBeInTheDocument();
    expect(screen.getByText("Cover · 1 van 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Afwisselend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Foto groot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ik wil dit later laten drukken" })).toBeInTheDocument();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toMatch(/printproof|sha-?256|revisie|checkout|betaling|stripe|peecho/i);
  });

  it("downloadt de gecontroleerde PDF van het getoonde boek en ruimt de tijdelijke URL op", async () => {
    state.draft = draftWith([cover(), updatePage()]);
    state.draft.proof = readyProof(state.draft.document);
    const { unmount } = render(<Photobook />);

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
    expect(state.loadProof).toHaveBeenCalledWith({
      revisionId: REVISION_ID,
      documentSha256: state.draft.document.checksumSha256,
      pdfSha256: "b".repeat(64),
      signal: expect.any(AbortSignal),
    });
    const link = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts[0] as HTMLAnchorElement;
    expect(link?.href).toBe("blob:buildy-pdf");
    expect(link?.download).toBe("Bouwboek.pdf");
    expect(state.requestProof).not.toHaveBeenCalled();
    unmount();
    expect(state.revokeObjectUrl).toHaveBeenCalledWith("blob:buildy-pdf");
  });

  it("maakt de actuele PDF, wacht op de bestaande status en biedt daarna downloaden aan", async () => {
    state.draft = draftWith([cover(), updatePage()]);
    state.requestProof.mockImplementation(async () => {
      state.draft!.proof = { ...readyProof(state.draft!.document), status: "rendering", pdfSha256: null, pdfPath: null };
      return { revisionId: REVISION_ID, status: "rendering", replayed: false };
    });
    const { rerender } = render(<Photobook />);

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce());
    expect(state.requestProof).toHaveBeenCalledWith({
      idempotencyKey: IDEMPOTENCY_KEY,
      expectedDraftVersion: state.draft.version,
      expectedDocumentSha256: state.draft.document.checksumSha256,
    });
    expect(screen.getByRole("button", { name: "PDF wordt gemaakt…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Je PDF wordt gemaakt.");
    expect(state.loadProof).not.toHaveBeenCalled();

    state.draft.proof = readyProof(state.draft.document);
    rerender(<Photobook />);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(state.loadProof).toHaveBeenCalledOnce());
    expect(state.requestProof).toHaveBeenCalledOnce();
  });

  it("gebruikt een oude vastgelegde PDF met evenveel pagina's niet voor het actuele boek", async () => {
    state.draft = draftWith([cover(), updatePage()]);
    state.draft.proof = { ...readyProof(state.draft.document), status: "locked", documentSha256: "c".repeat(64) };
    state.requestProof.mockRejectedValue(new Error("unavailable"));
    render(<Photobook />);

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Je PDF kon niet worden gemaakt of gedownload."));
    expect(state.requestProof).toHaveBeenCalledOnce();
    expect(state.loadProof).not.toHaveBeenCalled();
    expect(state.createObjectUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });

  it("start geen download wanneer de PDF-controle mislukt", async () => {
    state.draft = draftWith([cover(), updatePage()]);
    state.draft.proof = readyProof(state.draft.document);
    state.loadProof.mockRejectedValue(new Error("checksum mismatch"));
    render(<Photobook />);

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Probeer het opnieuw."));
    expect(state.createObjectUrl).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("toont bestaande boekmeldingen en houdt alleen blokkerende punten tegen bij downloaden", () => {
    state.draft = draftWith([cover(), updatePage()]);
    const warning = {
      code: "LOW_EFFECTIVE_DPI" as const,
      severity: "warning" as const,
      pageNumber: 2,
      assetId: null,
      updateId: UPDATE_ID,
      message: "Deze foto heeft een lage resolutie.",
    };
    state.draft.document.warnings = [warning, { ...warning }];
    const { rerender } = render(<Photobook />);

    expect(screen.getByRole("region", { name: "Let op in je Bouwboek" })).toBeInTheDocument();
    expect(screen.getAllByText("Pagina 2: Deze foto heeft een lage resolutie.")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();

    state.draft.document.warnings = [...state.draft.document.warnings, {
      code: "TEXT_OVERFLOW",
      severity: "blocking",
      pageNumber: 1,
      assetId: null,
      updateId: null,
      message: "De covertitel past niet binnen drie regels.",
    }];
    rerender(<Photobook />);

    expect(screen.getByText(/De covertitel past niet binnen drie regels/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(state.requestProof).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Bouwboekweergave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Foto groot" })).toBeEnabled();
  });
});
