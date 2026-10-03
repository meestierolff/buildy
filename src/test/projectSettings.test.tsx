import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectSettings from "@/components/project/ProjectSettings";
import type { ProjectOverview } from "../../shared/contracts/projects";

const mocks = vi.hoisted(() => ({ update: vi.fn(), removePhase: vi.fn(), prepare: vi.fn(), upload: vi.fn() }));
vi.mock("@/hooks/useProjectApi", () => ({ useUpdateProjectMutation: () => ({ isPending: false, mutateAsync: mocks.update }) }));
vi.mock("@/lib/projectApi", () => ({ deleteProjectPhase: (...args: unknown[]) => mocks.removePhase(...args) }));
vi.mock("@/lib/privateMediaApi", () => ({ preparePrivateProjectImage: (...args: unknown[]) => mocks.prepare(...args), uploadProjectImage: (...args: unknown[]) => mocks.upload(...args) }));

const project = {
  id: "11111111-1111-4111-8111-111111111111", version: 8,
  startDate: "2026-10-01", expectedEndDate: "2026-10-31",
  phases: [{ id: "22222222-2222-4222-8222-222222222222", name: "Eigen fase", isCustom: true, sortOrder: 1 },
    { id: "33333333-3333-4333-8333-333333333333", name: "Voorbereiding", isCustom: false, sortOrder: 0 }],
} as ProjectOverview;
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProjectSettings project={project} /></QueryClientProvider>);
  return client;
}

describe("project settings", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("saves the planning with the loaded optimistic version", async () => {
    mocks.update.mockResolvedValue({ project });
    setup();
    fireEvent.change(screen.getByLabelText("Begindatum"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Planning opslaan" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ expectedVersion: 8, startDate: "2026-09-01", expectedEndDate: "2026-10-31" }));
  });

  it("uploads a deliberate cover under project_cover scope and refreshes project views", async () => {
    const file = new File(["photo"], "cover.jpg", { type: "image/jpeg" });
    const prepared = { file };
    mocks.prepare.mockResolvedValue(prepared);
    mocks.upload.mockResolvedValue({ id: "cover-id" });
    const client = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByLabelText(/Omslagfoto kiezen/), { target: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith({ projectId: project.id, purpose: "project_cover", idempotencyKey: expect.stringMatching(/^project-cover:/), prepared }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects"] }));
  });

  it("retries an uncertain phase deletion with the same version even after the project refreshes", async () => {
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><ProjectSettings project={project} /></QueryClientProvider>);
    mocks.removePhase.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ project, phaseId: project.phases[0].id, deleted: true });
    const confirm = () => {
      fireEvent.click(screen.getByRole("button", { name: "Fase Eigen fase verwijderen" }));
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Fase verwijderen" }));
    };
    confirm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Fase Eigen fase verwijderen" })).not.toBeDisabled());
    view.rerender(<QueryClientProvider client={client}><ProjectSettings project={{ ...project, version: 9 }} /></QueryClientProvider>);
    confirm();
    await waitFor(() => expect(mocks.removePhase).toHaveBeenCalledTimes(2));
    expect(mocks.removePhase.mock.calls[1]).toEqual(mocks.removePhase.mock.calls[0]);
  });

  it("confirms custom-phase deletion and refreshes the retained moments", async () => {
    mocks.removePhase.mockResolvedValue({ project: { ...project, version: 9, phases: [] }, phaseId: project.phases[0].id, deleted: true });
    const client = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect(screen.queryByRole("button", { name: /Fase Voorbereiding verwijderen/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fase Eigen fase verwijderen" }));
    expect(mocks.removePhase).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Bouwmomenten, foto’s en aantekeningen blijven bewaard/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fase verwijderen" }));
    await waitFor(() => expect(mocks.removePhase).toHaveBeenCalledWith(project.id, project.phases[0].id, { expectedProjectVersion: 8, idempotencyKey: expect.stringMatching(/^phase-delete:/) }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects"] });
  });
});
