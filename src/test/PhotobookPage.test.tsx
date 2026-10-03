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
const ASSET_ID = "66666666-6666-4666-8666-666666666666";
const REVISION_ID = "44444444-4444-4444-8444-444444444444";
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

const state = vi.hoisted(() => ({
  preview: vi.fn(),
  draft: undefined as PhotobookDraft | undefined,
  navigate: vi.fn(),
  refetch: vi.fn(),
  requestProof: vi.fn(),
  saveSettings: vi.fn(),
  replaceExclusions: vi.fn(),
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
    mutateAsync: state.replaceExclusions,
  }),
  useUpdatePhotobookSettings: () => ({
    isPending: false,
    mutateAsync: state.saveSettings,
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
  previewPhotobookSettings: state.preview,
}));
vi.mock("@/lib/router", () => ({
  useNavigate: () => state.navigate,
  useParams: () => ({ id: PROJECT_ID }),
  Link: ({ to, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    children?: ReactNode;
  }) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("@/components/photobook/BookOrderPanel", () => ({ BookOrderPanel: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Boek bestellen</button> }));

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
    state.preview.mockReset().mockImplementation(async () => state.draft!.document);
    state.navigate.mockReset();
    state.refetch.mockReset().mockImplementation(async () => ({ data: state.draft }));
    state.requestProof.mockReset();
    state.saveSettings.mockReset().mockResolvedValue(undefined);
    state.replaceExclusions.mockReset().mockResolvedValue(undefined);
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
      name: "Je verbouwing, om te bewaren",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: "Je eerste bladzijde begint met een Bouwmoment",
    })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Bouwboekweergave" })).not.toBeInTheDocument();
  });

  it("zet het boek voorop en verdeelt de editor over drie toegankelijke onderdelen", () => {
    state.draft = draftWith([cover(), updatePage()]);
    render(<Photobook />);

    expect(screen.getByRole("region", { name: "Bouwboekweergave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bouwmoment, bladzijde 2/i })).toBeInTheDocument();
    expect(screen.getByText("Cover · 1 van 2")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cover" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Inhoud" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Indeling" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("button", { name: /Afwisselend/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Foto groot/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Collage/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ik wil dit later laten drukken" })).not.toBeInTheDocument();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toMatch(/printproof|sha-?256|revisie|checkout|betaling|stripe|peecho/i);
  });


  it("bewaart de ondertitel en gekozen momentindeling en blokkeert een verouderde boekaanvraag", async () => {
    state.draft = draftWith([cover(), updatePage()]);
    state.draft.settings = {
      ...settings,
      preferences: { ...settings.preferences, layoutByPage: { [`update:${UPDATE_ID}:photos:1`]: "grid" } },
    };
    render(<Photobook />);

    fireEvent.change(screen.getByLabelText("Ondertitel"), { target: { value: "Ons eerste thuis" } });
    expect(screen.getByRole("button", { name: "Boek bestellen" })).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Indeling" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: /Foto groot/ }));
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(state.saveSettings).toHaveBeenCalledOnce());
    expect(state.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      subtitle: "Ons eerste thuis",
      preferences: expect.objectContaining({ layoutByPage: { [UPDATE_ID]: "one" } }),
    }));
  });

  it("kan de laatste foto uitsluiten zonder het originele Bouwmoment te veranderen", async () => {
    const momentPage = updatePage();
    momentPage.blocks.push({
      id: "story-photo", type: "photo", assetId: ASSET_ID,
      frame: { xMm: 129, yMm: 12, widthMm: 156, heightMm: 186 },
      crop: { fit: "contain", focusX: 0.5, focusY: 0.5, zoom: 1 },
      effectiveDpi: 300, altText: "Testfoto",
    });
    state.draft = draftWith([cover(), momentPage]);
    state.draft.exclusions = [{ targetType: "chapter", chapterKey: "older-chapter" }];
    render(<Photobook />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Inhoud" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Foto 1 verbergen" }));
    await waitFor(() => expect(state.replaceExclusions).toHaveBeenCalledWith({ exclusions: [
      { targetType: "chapter", chapterKey: "older-chapter" },
      { targetType: "media", mediaAssetId: ASSET_ID },
    ] }));
    expect(state.saveSettings).not.toHaveBeenCalled();
  });

  it("houdt terugzetten bereikbaar als alle Bouwmomenten verborgen zijn", async () => {
    state.draft = draftWith([cover()]);
    state.draft.exclusions = [{ targetType: "update", updateId: UPDATE_ID }];
    render(<Photobook />);

    expect(screen.getByRole("tab", { name: "Inhoud" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Verborgen Bouwmoment 1 terugzetten" }));
    await waitFor(() => expect(state.replaceExclusions).toHaveBeenCalledWith({ exclusions: [] }));
  });

  it("bewaart foto-uitsnedes via de bestaande instellingen en normaliseert hele-fotoweergave", async () => {
    const momentPage = updatePage();
    momentPage.blocks.push({
      id: "story-photo", type: "photo", assetId: ASSET_ID,
      frame: { xMm: 129, yMm: 12, widthMm: 156, heightMm: 186 },
      crop: { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 2 },
      effectiveDpi: 300, altText: "Testfoto",
    });
    state.draft = draftWith([cover(), momentPage]);
    render(<Photobook />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Inhoud" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Uitsnede" }));
    fireEvent.change(screen.getByLabelText("Positie links / rechts"), { target: { value: "0.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Hele foto" }));
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(state.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ cropByAsset: {
        [ASSET_ID]: { fit: "contain", focusX: 0.75, focusY: 0.5, zoom: 1 },
      } }),
    })));
  });

  it("bewaart de gekozen bewerkingscontext wanneer een desktopspread op de vorige pagina begint", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: true, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => false),
    }));
    const secondUpdateId = "77777777-7777-4777-8777-777777777777";
    const secondPage = updatePage();
    secondPage.id = `update:${secondUpdateId}:text:1`;
    secondPage.updateId = secondUpdateId;
    secondPage.number = 3;
    secondPage.blocks = secondPage.blocks.map((block) => block.type === "text" && block.id.includes(":title")
      ? { ...block, text: "De tweede muur", lines: ["De tweede muur"] }
      : block);
    state.draft = draftWith([cover(), updatePage(), secondPage]);
    render(<Photobook />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Inhoud" }), { button: 0, ctrlKey: false });
    fireEvent.change(screen.getByLabelText("Bouwmoment"), { target: { value: secondUpdateId } });
    expect(screen.getByText("2–3 van 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Bouwmoment")).toHaveValue(secondUpdateId);
    fireEvent.click(screen.getByRole("button", { name: "Moment verbergen" }));
    await waitFor(() => expect(state.replaceExclusions).toHaveBeenCalledWith({ exclusions: [
      { targetType: "update", updateId: secondUpdateId },
    ] }));

    fireEvent.click(screen.getByRole("button", { name: "Vorige pagina" }));
    expect(screen.getByRole("tab", { name: "Cover" })).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Indeling" }), { button: 0, ctrlKey: false });
    expect(screen.getByLabelText("Indeling voor Bouwmoment")).toHaveValue(secondUpdateId);
    fireEvent.click(screen.getByRole("button", { name: /Foto groot/ }));
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(state.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ layoutByPage: { [secondUpdateId]: "one" } }),
    })));
  });

  it("biedt alleen bestellen, ook als een historische PDF bestaat", () => {
    state.draft = draftWith([cover(), updatePage()]);
    state.draft.proof = readyProof(state.draft.document);
    render(<Photobook />);
    expect(screen.queryByRole("button", { name: "Download PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boek bestellen" })).toBeEnabled();
    expect(state.requestProof).not.toHaveBeenCalled();
    expect(state.loadProof).not.toHaveBeenCalled();
  });

  it("volgt het getoonde Bouwmoment bij bladeren en springt bij de cover naar coveropties", () => {
    const secondId = "77777777-7777-4777-8777-777777777777";
    state.draft = draftWith([cover(), updatePage(), { ...updatePage(), id: "second", number: 3, updateId: secondId }]);
    render(<Photobook />);
    fireEvent.click(screen.getByRole("button", { name: /bouwmoment, bladzijde 3/i }));
    expect(screen.getByLabelText("Bouwmoment")).toHaveValue(secondId);
    fireEvent.click(screen.getByRole("button", { name: /cover, bladzijde 1/i }));
    expect(screen.getByRole("tab", { name: "Cover" })).toHaveAttribute("aria-selected", "true");
  });

  it("bouwt een direct canonical voorbeeld zonder de instellingen op te slaan", async () => {
    state.draft = draftWith([cover(), updatePage()]);
    const next = { ...state.draft.document, pageCount: 3, pages: [cover(), updatePage(), { ...cover(), id: "back-cover", number: 3 }], checksumSha256: "c".repeat(64) };
    state.preview.mockResolvedValue(next);
    render(<Photobook />);
    fireEvent.change(screen.getByLabelText("Ondertitel"), { target: { value: "Ons eerste thuis" } });
    await waitFor(() => expect(state.preview).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({ subtitle: "Ons eerste thuis" }), expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByText("3 pagina’s")).toBeInTheDocument());
    expect(state.saveSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Boek bestellen" })).toBeDisabled();
  });

  it("toont bestaande boekmeldingen en houdt alleen blokkerende punten tegen bij bestellen", () => {
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
    expect(screen.getAllByText("Pagina 2: Deze foto kan wat onscherp worden als je ver inzoomt. Kies eventueel een grotere foto.")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Boek bestellen" })).toBeEnabled();

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
    expect(screen.getByRole("button", { name: "Boek bestellen" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Boek bestellen" }));
    expect(state.requestProof).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Bouwboekweergave" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Indeling" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("button", { name: /Foto groot/ })).toBeEnabled();
  });
});
