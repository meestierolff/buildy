import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LegacyRedirect from "@/components/app/LegacyRedirect";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { BrowserRouter, Route, Routes } from "@/lib/router";

describe("legacy product redirects", () => {
  it("preserves query and hash while replacing a dynamic project route", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    window.history.replaceState({}, "", `/trip/${projectId}?tab=fotos&filter=voor%20en%20na#update-bestaand`);

    render(
      <BrowserRouter>
        <Routes>
          <Route
            path="/trip/:id"
            element={(
              <LegacyRedirect resolve={(params) => (
                params.id ? PRODUCT_ROUTES.project(params.id) : null
              )} />
            )}
          />
          <Route path="/project/:id" element={<p>Canoniek project</p>} />
        </Routes>
      </BrowserRouter>,
    );

    await waitFor(() => expect(window.location.pathname).toBe(`/project/${projectId}`));
    expect(window.location.search).toBe("?tab=fotos&filter=voor%20en%20na");
    expect(window.location.hash).toBe("#update-bestaand");
  });

  it("falls back without ever emitting an undefined path segment", async () => {
    window.history.replaceState({}, "", "/oude-route?bron=bookmark#inhoud");

    render(
      <BrowserRouter>
        <LegacyRedirect resolve={(params) => (
          params.id ? PRODUCT_ROUTES.project(params.id) : null
        )} />
      </BrowserRouter>,
    );

    await waitFor(() => expect(window.location.pathname).toBe(PRODUCT_ROUTES.landing));
    expect(window.location.href).not.toContain("undefined");
    expect(window.location.search).toBe("?bron=bookmark");
    expect(window.location.hash).toBe("#inhoud");
  });
});
