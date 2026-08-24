import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ProjectCard from "@/components/ProjectCard";
import { BrowserRouter } from "@/lib/router";

const renderCard = (props: Partial<React.ComponentProps<typeof ProjectCard>> = {}) => render(
  <BrowserRouter>
    <ProjectCard
      id="project-123"
      title="Jaren-30 woning"
      projectType="Totaalrenovatie"
      progressPercentage={64}
      profileName="Noor"
      updateCount={8}
      {...props}
    />
  </BrowserRouter>,
);

describe("ProjectCard", () => {
  it("maakt openbare zichtbaarheid en voortgang expliciet", () => {
    renderCard({ visibility: "public" });

    expect(screen.getByRole("link", { name: /jaren-30 woning bekijken.*openbare verbouwing/i })).toHaveAttribute("href", "/project/project-123");
    expect(screen.getByLabelText(/openbaar.*zichtbaar voor iedereen/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /voortgang van jaren-30 woning/i })).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("8 Bouwmomenten")).toBeInTheDocument();
  });

  it("labelt een privéproject zonder de waarde buiten het bereik te laten lopen", () => {
    renderCard({ visibility: "private", progressPercentage: 140, updateCount: 1 });

    expect(screen.getByRole("link", { name: /alleen voor de eigenaar/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/privé.*alleen zichtbaar voor jou/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("1 Bouwmoment")).toBeInTheDocument();
  });

  it("verzint geen zichtbaarheid wanneer de aanroepende pagina die niet kent", () => {
    renderCard();

    expect(screen.queryByText("Openbaar")).not.toBeInTheDocument();
    expect(screen.queryByText("Privé")).not.toBeInTheDocument();
  });
});
