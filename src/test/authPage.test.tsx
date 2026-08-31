import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { useAppFeatures } from "@/lib/appFeatures";
import { BrowserRouter } from "@/lib/router";
import Auth from "@/pages/Auth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/lib/appFeatures", () => ({ useAppFeatures: vi.fn() }));

describe("Google-only auth page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/auth?mode=register");
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: false,
      refreshing: false,
      error: null,
      refetchSession: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(useAppFeatures).mockReturnValue({
      googleSignInEnabled: true,
    } as ReturnType<typeof useAppFeatures>);
  });

  it("toont één Google-actie zonder invite-, wachtwoord- of modetabs", () => {
    render(<BrowserRouter><Auth /></BrowserRouter>);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Doorgaan met Google" })).toBeEnabled();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/e-mail|wachtwoord|invite|uitnodiging/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/priv(?:ate|é)[ -]?bèta|magic link|wachtwoord reset/i)).not.toBeInTheDocument();
  });
});
