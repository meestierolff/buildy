import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import NewTrip from "@/pages/NewTrip";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  navigate: vi.fn(),
  deleteLandingPhoto: vi.fn(),
  search: "",
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "browser-session-user" }, loading: false }),
}));

vi.mock("@/hooks/useProjectApi", () => ({
  useCreateProjectMutation: () => ({ mutateAsync: mocks.createProject }),
}));

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));

vi.mock("@/lib/landingPhotoHandoffStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/landingPhotoHandoffStore")>()),
  deleteLandingPhotoHandoff: mocks.deleteLandingPhoto,
}));

vi.mock("@/lib/router", async () => {
  const React = await import("react");
  return {
    Navigate: () => null,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...props}>{children}</a>
    ),
    useNavigate: () => mocks.navigate,
    useSearchParams: () => [new URLSearchParams(mocks.search)],
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("NewTrip typed API retry", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = "";
    mocks.deleteLandingPhoto.mockResolvedValue(undefined);
    mocks.createProject
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        project: { id: PROJECT_ID },
        replayed: true,
      });
  });

  it("retains one private-default create command after an ambiguous response", async () => {
    render(<NewTrip />);

    const title = screen.getByRole("textbox", { name: /Hoe heet je verbouwing/ });
    fireEvent.change(title, { target: { value: "Ons jaren-30 huis" } });
    fireEvent.click(screen.getByRole("button", { name: "Verbouwing starten" }));

    await screen.findByText(/serverbevestiging ontbreekt nog/i);
    expect(title).toBeDisabled();
    const firstCommand = mocks.createProject.mock.calls[0]?.[0];
    expect(firstCommand).toMatchObject({
      visibility: "private",
      input: { title: "Ons jaren-30 huis" },
    });
    expect(firstCommand.input).not.toHaveProperty("userId");
    expect(firstCommand.input).not.toHaveProperty("user_id");

    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(
      `/project/${PROJECT_ID}?update=nieuw`,
      { replace: true },
    ));
    expect(mocks.createProject).toHaveBeenCalledTimes(2);
    expect(mocks.createProject.mock.calls[1]?.[0]).toBe(firstCommand);
  });

  it("draagt alleen de statische startfoto-intentie over naar de eerste composer", async () => {
    mocks.search = "intent=eerste-bouwmoment";
    mocks.createProject.mockReset().mockResolvedValue({
      project: { id: PROJECT_ID },
      replayed: false,
    });
    render(<NewTrip />);

    fireEvent.change(screen.getByRole("textbox", { name: /Hoe heet je verbouwing/ }), {
      target: { value: "Ons familiehuis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verbouwing starten" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(
      `/project/${PROJECT_ID}?update=nieuw&intent=eerste-bouwmoment`,
      { replace: true },
    ));
    expect(mocks.navigate.mock.calls[0]?.[0]).not.toContain(".jpg");
  });

  it("wist de lokale startfoto wanneer de projectreis bewust wordt geannuleerd", async () => {
    mocks.search = "intent=eerste-bouwmoment";
    render(<NewTrip />);

    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));

    await waitFor(() => expect(mocks.deleteLandingPhoto).toHaveBeenCalledTimes(1));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("vraagt alleen om een naam en optioneel type en maakt altijd privé aan", async () => {
    mocks.createProject.mockReset().mockResolvedValue({
      project: { id: PROJECT_ID },
      replayed: false,
    });
    render(<NewTrip />);

    expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("textbox", { name: /Hoe heet je verbouwing/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Wat verbouw je/ })).toBeInTheDocument();
    expect(screen.getByText(/Je begint privé/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/adres|startdatum|einddatum|beschrijving|wie kan/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /Hoe heet je verbouwing/ }), {
      target: { value: "Ons familiehuis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verbouwing starten" }));

    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledOnce());
    expect(mocks.createProject.mock.calls[0]?.[0]).toMatchObject({
      visibility: "private",
      input: { title: "Ons familiehuis" },
    });
  });
});
