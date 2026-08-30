// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

const state = vi.hoisted(() => ({
  draft: undefined as PhotobookDraft | undefined,
  navigate: vi.fn(),
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
    refetch: vi.fn(),
  }),
  useReplacePhotobookExclusions: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdatePhotobookSettings: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
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

describe("Bouwboekpagina", () => {
  beforeEach(() => {
    state.navigate.mockReset();
  });

  afterEach(cleanup);

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
    expect(screen.getByRole("button", { name: /voorwoord, bladzijde 2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tot slot, bladzijde 4/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Afwisselend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Foto groot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ik wil dit later laten drukken" })).toBeInTheDocument();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toMatch(/printproof|sha-?256|revisie|checkout|betaling|stripe|peecho/i);
  });
});
