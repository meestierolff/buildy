import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { authClient, AuthClientError } from "@/lib/authClient";
import { useAppFeatures } from "@/lib/appFeatures";
import { BrowserRouter } from "@/lib/router";
import Auth from "@/pages/Auth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/lib/appFeatures", () => ({ useAppFeatures: vi.fn() }));

const password = "Drie rustige bouwdagen";
const refetchSession = vi.fn();

function renderAuth(path = "/auth") {
  window.history.replaceState({}, "", path);
  return render(<BrowserRouter><Auth /></BrowserRouter>);
}

function fillCredentials() {
  fireEvent.change(screen.getByLabelText("Gebruikersnaam", { exact: true }), { target: { value: "bouw-eigenaar" } });
  fireEvent.change(screen.getByLabelText("Wachtwoord", { exact: true }), { target: { value: password } });
}

describe("username/password auth page", () => {
  beforeEach(() => {
    refetchSession.mockReset().mockResolvedValue({ user: null, session: null });
    vi.mocked(useAuth).mockReturnValue({
      user: null, session: null, loading: false, refreshing: false, error: null,
      refetchSession, signOut: vi.fn(),
    });
    vi.mocked(useAppFeatures).mockReturnValue({
      passwordSignInEnabled: true,
    } as ReturnType<typeof useAppFeatures>);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows username/password login without Google, email or unavailable reset controls", () => {
    renderAuth();
    expect(screen.getByRole("button", { name: /^Inloggen$/ })).toBeEnabled();
    expect(screen.getByLabelText("Gebruikersnaam", { exact: true })).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveAttribute("type", "password");
    expect(screen.queryByText(/Google|magic link|wachtwoord vergeten/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/e-mail|invite|uitnodiging/i)).not.toBeInTheDocument();
  });

  it("keeps the destination when switching modes and clears the previous password", () => {
    renderAuth("/auth?next=%2Fproject%2Fnieuw%3Fintent%3Deerste-bouwmoment");
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /^Account maken$/ }));
    expect(screen.getByRole("heading", { name: "Je verhaal begint hier." })).toBeInTheDocument();
    expect(screen.getByLabelText("Gebruikersnaam", { exact: true })).toHaveValue("bouw-eigenaar");
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    expect(new URL(window.location.href).searchParams.get("next")).toBe("/project/nieuw?intent=eerste-bouwmoment");
  });

  it("lets the user show and hide the password without submitting", () => {
    const signIn = vi.spyOn(authClient, "signIn");
    renderAuth();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Wachtwoord tonen" }));
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Wachtwoord verbergen" }));
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveAttribute("type", "password");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("validates signup before sending credentials", () => {
    const signUp = vi.spyOn(authClient, "signUp");
    renderAuth("/auth?mode=register");
    fillCredentials();
    fireEvent.change(screen.getByLabelText("Wachtwoord", { exact: true }), { target: { value: "te kort" } });
    fireEvent.submit(screen.getByRole("form", { name: "Account maken" }));
    expect(screen.getByRole("alert")).toHaveTextContent("15 tot 128 tekens");
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each([
    ["signIn", "/auth", "Inloggen"],
    ["signUp", "/auth?mode=register", "Account maken"],
  ] as const)("refreshes the server session after %s without navigating before it is confirmed", async (method, path, name) => {
    const authenticate = vi.spyOn(authClient, method).mockResolvedValue("/project/nieuw?intent=eerste-bouwmoment");
    renderAuth(path + (path.includes("?") ? "&" : "?") + "next=%2Fproject%2Fnieuw%3Fintent%3Deerste-bouwmoment");
    fillCredentials();
    fireEvent.submit(screen.getByRole("form", { name }));
    await waitFor(() => expect(refetchSession).toHaveBeenCalledTimes(1));
    expect(authenticate).toHaveBeenCalledExactlyOnceWith({
      username: "bouw-eigenaar", password, next: "/project/nieuw?intent=eerste-bouwmoment",
    });
    expect(screen.getByLabelText("Wachtwoord", { exact: true })).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("Je sessie kon niet worden bevestigd");
  });

  it("shows generic invalid credentials without echoing a provider message", async () => {
    vi.spyOn(authClient, "signIn").mockRejectedValue(new AuthClientError("private provider detail", 401, "INVALID_CREDENTIALS"));
    renderAuth();
    fillCredentials();
    fireEvent.submit(screen.getByRole("form", { name: "Inloggen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Je gebruikersnaam of wachtwoord klopt niet");
    expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
    expect(refetchSession).not.toHaveBeenCalled();
  });

  it("fails closed when authentication is unavailable", () => {
    vi.mocked(useAppFeatures).mockReturnValue({ passwordSignInEnabled: false } as ReturnType<typeof useAppFeatures>);
    renderAuth();
    expect(screen.getByRole("status")).toHaveTextContent("nog niet beschikbaar");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
