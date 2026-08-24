import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";

describe("ResilientMedia", () => {
  it("vervangt een mislukte foto door een zichtbare toegankelijke melding", () => {
    const onError = vi.fn();
    render(
      <ResilientImage
        src="/api/media/foto"
        alt="Keuken voor de verbouwing"
        fallbackLabel="Omslagfoto niet beschikbaar"
        onError={onError}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Keuken voor de verbouwing" }));

    expect(onError).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Omslagfoto niet beschikbaar");
    expect(screen.queryByRole("img", { name: "Keuken voor de verbouwing" })).not.toBeInTheDocument();
  });

  it("probeert opnieuw wanneer de foto-URL verandert", () => {
    const { rerender } = render(
      <ResilientImage src="/api/media/eerste" alt="Bouwfoto" />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Bouwfoto" }));
    expect(screen.getByRole("status")).toHaveTextContent("Foto niet beschikbaar");

    rerender(<ResilientImage src="/api/media/tweede" alt="Bouwfoto" />);

    expect(screen.getByRole("img", { name: "Bouwfoto" })).toHaveAttribute(
      "src",
      "/api/media/tweede",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("vervangt een mislukte video zonder een permanente object-URL te tonen", () => {
    const { container } = render(
      <ResilientVideo src="/api/media/video" aria-label="Video van de woonkamer" controls />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);

    expect(screen.getByRole("status")).toHaveTextContent("Video niet beschikbaar");
    expect(container.querySelector("video")).toBeNull();
    expect(container).not.toHaveTextContent("/api/media/video");
  });
});
