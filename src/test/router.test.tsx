import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BrowserRouter,
  Link,
  NavLink,
  normalizeAppPath,
  Route,
  Routes,
  useLocation,
  useParams,
} from "@/lib/router";

const ProjectRoute = () => {
  const { id } = useParams<{ id: string }>();
  return <p>Project {id}</p>;
};

describe("browserrouter", () => {
  it("matches dynamische routes en navigeert zonder paginareload", () => {
    window.history.replaceState({}, "", "/project/project-123");

    render(
      <BrowserRouter>
        <Link to="/privacy">Privacy</Link>
        <Routes>
          <Route path="/project/:id" element={<ProjectRoute />} />
          <Route path="/privacy" element={<p>Privacyverklaring</p>} />
          <Route path="*" element={<p>Niet gevonden</p>} />
        </Routes>
      </BrowserRouter>,
    );

    expect(screen.getByText("Project project-123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Privacy" }));
    expect(screen.getByText("Privacyverklaring")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/privacy");
  });

  it("markeert alleen de actieve navigatieroute", () => {
    window.history.replaceState({}, "", "/connecties");

    render(
      <BrowserRouter>
        <NavLink to="/connecties" end>Connecties</NavLink>
        <NavLink to="/volgend" end>Volgend</NavLink>
      </BrowserRouter>,
    );

    expect(screen.getByRole("link", { name: "Connecties" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Volgend" })).not.toHaveAttribute("aria-current");
  });

  it("werkt de locatie bij bij navigatie naar een query en hash op hetzelfde pad", () => {
    window.history.replaceState({ source: "initial" }, "", "/project/project-123");
    const LocationProbe = () => {
      const location = useLocation();
      return <output>{`${location.pathname}${location.search}${location.hash}:${String((location.state as { source?: string } | null)?.source)}`}</output>;
    };

    render(
      <BrowserRouter>
        <Link to="/project/project-123?update=nieuw#verhaal" state={{ source: "navigation" }}>
          Bouwmoment toevoegen
        </Link>
        <LocationProbe />
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Bouwmoment toevoegen" }));

    expect(screen.getByText("/project/project-123?update=nieuw#verhaal:navigation")).toBeInTheDocument();
  });

  it("weigert protocol-relative en backslash-bestemmingen", () => {
    expect(() => normalizeAppPath("//attacker.example")).toThrow("veilige absolute app-paden");
    expect(() => normalizeAppPath("/veilig\\attacker")).toThrow("veilige absolute app-paden");
  });
});
