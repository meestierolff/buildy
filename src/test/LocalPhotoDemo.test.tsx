import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LocalPhotoDemo from "@/components/landing/LocalPhotoDemo";
import { BrowserRouter } from "@/lib/router";

const mocks = vi.hoisted(() => ({
  saveLandingPhoto: vi.fn(),
}));

vi.mock("@/lib/landingPhotoHandoffStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/landingPhotoHandoffStore")>()),
  saveLandingPhotoHandoff: mocks.saveLandingPhoto,
}));

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

describe("lokale foto-demo", () => {
  const createObjectUrl = vi.fn(() => "blob:buildy-local-preview");
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveLandingPhoto.mockResolvedValue(undefined);
    window.history.replaceState(null, "", "/");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
  });

  afterEach(() => {
    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    vi.unstubAllGlobals();
  });

  it("maakt de hele voorvertoning lokaal en bewaart pas bij de bewuste vervolgstap", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<BrowserRouter><LocalPhotoDemo /></BrowserRouter>);
    const photo = new File(["lokale foto"], "straat-en-huisnummer.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByLabelText("Kies een verbouwfoto van dit apparaat"), {
      target: { files: [photo] },
    });

    expect(createObjectUrl).toHaveBeenCalledWith(photo);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("02 · Bouwmoment")).toBeInTheDocument();
    expect(screen.getByText("03 · Verhaal")).toBeInTheDocument();
    expect(screen.getByText("04 · Bouwboek")).toBeInTheDocument();
    expect(screen.getAllByAltText("Jouw gekozen verbouwfoto in de lokale voorbeeldweergave")).toHaveLength(3);
    expect(document.body.textContent).not.toContain(photo.name);
    expect(screen.getByText(/Pas na Google-login en wanneer jij het Bouwmoment plaatst/i)).toBeInTheDocument();

    const saveLink = screen.getByRole("link", { name: /bewaar dit bouwmoment/i });
    const destination = new URL(saveLink.getAttribute("href") ?? "", "https://buildy.test");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("provider")).toBe("google");
    expect(destination.searchParams.get("mode")).toBe("register");
    expect(destination.searchParams.get("next")).toBe("/project/nieuw?intent=eerste-bouwmoment");

    expect(mocks.saveLandingPhoto).not.toHaveBeenCalled();
    fireEvent.click(saveLink);
    await waitFor(() => expect(mocks.saveLandingPhoto).toHaveBeenCalledWith(photo));
    expect(fetchMock).not.toHaveBeenCalled();

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:buildy-local-preview");
  });

  it("weigert niet-afbeeldingen zonder een lokale URL te maken", () => {
    render(<BrowserRouter><LocalPhotoDemo /></BrowserRouter>);
    const documentFile = new File(["geen foto"], "adres.txt", { type: "text/plain" });

    fireEvent.change(screen.getByLabelText("Kies een verbouwfoto van dit apparaat"), {
      target: { files: [documentFile] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/Kies een JPG-, PNG-, WebP-, AVIF-, HEIC- of HEIF-foto/i);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /bewaar dit bouwmoment/i })).not.toBeInTheDocument();
  });

  it("blijft staan en toont richting als lokale opslag faalt", async () => {
    mocks.saveLandingPhoto.mockRejectedValueOnce(new Error("quota"));
    render(<BrowserRouter><LocalPhotoDemo /></BrowserRouter>);
    const photo = new File(["lokale foto"], "keuken.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Kies een verbouwfoto van dit apparaat"), {
      target: { files: [photo] },
    });
    fireEvent.click(screen.getByRole("link", { name: /bewaar dit bouwmoment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Deze foto kon niet op dit apparaat worden bewaard. Probeer het opnieuw voordat je verdergaat.",
    );
    expect(window.location.pathname).not.toBe("/auth");
  });
});
