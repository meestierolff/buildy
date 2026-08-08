import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import NewTrip from "@/pages/NewTrip";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  navigate: vi.fn(),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "browser-session-user" }, loading: false }),
}));

vi.mock("@/hooks/useProjectApi", () => ({
  useCreateProjectMutation: () => ({ mutateAsync: mocks.createProject }),
}));

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));

vi.mock("@/lib/router", async () => {
  const React = await import("react");
  return {
    Navigate: () => null,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...props}>{children}</a>
    ),
    useNavigate: () => mocks.navigate,
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
    mocks.createProject
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        project: { id: PROJECT_ID },
        replayed: true,
      });
  });

  it("retains one private-default create command after an ambiguous response", async () => {
    render(<NewTrip />);

    const title = screen.getByLabelText("Projectnaam *");
    fireEvent.change(title, { target: { value: "Ons jaren-30 huis" } });
    fireEvent.click(screen.getByRole("button", { name: "Project starten" }));

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
      `/project/${PROJECT_ID}`,
      { replace: true },
    ));
    expect(mocks.createProject).toHaveBeenCalledTimes(2);
    expect(mocks.createProject.mock.calls[1]?.[0]).toBe(firstCommand);
  });
});
