import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { photobookDocumentSchema, type PhotobookDocument } from "../../shared/contracts/photobooks";
import { PhotobookViewer } from "@/components/photobook/PhotobookViewer";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function viewerDocument(): PhotobookDocument {
  return photobookDocumentSchema.parse({
    version: 1,
    projectId: PROJECT_ID,
    projectRevision: 1,
    selectedFormat: "a4-landscape-hardcover-v1",
    locale: "nl-NL",
    print: { widthMm: 297, heightMm: 210, safeMarginMm: 12, bleedMm: 0, targetDpi: 300, colorSpace: "RGB" },
    cover: { title: "Testboek", subtitle: "", mediaAssetId: null, crop: null },
    chapters: [],
    pages: Array.from({ length: 24 }, (_, index) => ({
      id: index === 0 ? "cover" : `blank:${index + 1}`,
      number: index + 1,
      kind: index === 0 ? "cover" : "blank",
      chapterId: null,
      updateId: null,
      background: index === 0 ? "#142238" : "#ffffff",
      overlay: null,
      blocks: index === 0 ? [{
        id: "title",
        type: "text",
        frame: { xMm: 20, yMm: 80, widthMm: 257, heightMm: 50 },
        font: "instrument-serif",
        weight: "regular",
        style: "normal",
        fontSizePt: 30,
        lineHeightPt: 34,
        align: "center",
        color: "#ffffff",
        text: "Deze tekst mag de browser niet zelf omlopen",
        lines: ["Vastgelegde regel één", "Vastgelegde regel twee"],
      }] : [],
    })),
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: 24,
    warnings: [],
    checksumSha256: "a".repeat(64),
  });
}

const Harness = () => {
  const [page, setPage] = useState(0);
  return <PhotobookViewer activePage={page} document={viewerDocument()} onActivePageChange={setPage} />;
};

describe("PhotobookViewer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rendert uitsluitend persisted lines en eenvoudige paginanavigatie", () => {
    render(<Harness />);

    expect(screen.getAllByText("Vastgelegde regel één")).not.toHaveLength(0);
    expect(screen.getAllByText("Vastgelegde regel twee")).not.toHaveLength(0);
    expect(screen.queryByText("Deze tekst mag de browser niet zelf omlopen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vorige pagina" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Volgende pagina" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Bouwboekweergave" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Zoomniveau van het Bouwboek")).not.toBeInTheDocument();
  });

  it("bladert mobiel met knop en toetsenbord één pagina per keer", () => {
    render(<Harness />);
    const viewer = screen.getByRole("region", { name: "Bouwboekweergave" });

    fireEvent.click(screen.getByRole("button", { name: "Volgende pagina" }));
    expect(screen.getByText("Verhaal · 2 van 24")).toBeInTheDocument();
    fireEvent.keyDown(viewer, { key: "End" });
    expect(screen.getByText("Verhaal · 24 van 24")).toBeInTheDocument();
    fireEvent.keyDown(viewer, { key: "Home" });
    expect(screen.getByText("Cover · 1 van 24")).toBeInTheDocument();
    const pageViewport = viewer.querySelector(".overflow-hidden.rounded-lg");
    expect(pageViewport).not.toBeNull();
    fireEvent.touchStart(pageViewport!, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(pageViewport!, { changedTouches: [{ clientX: 220 }] });
    expect(screen.getByText("Verhaal · 2 van 24")).toBeInTheDocument();
  });

  it("toont de cover los en daarna echte gebonden spreads op desktop", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    render(<Harness />);

    expect(screen.getByText("Cover · 1 van 24")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volgende pagina" }));
    expect(screen.getByText("2–3 van 24")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vorige pagina" }));
    expect(screen.getByText("Cover · 1 van 24")).toBeInTheDocument();
  });
});
