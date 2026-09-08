import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/authClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/authClient")>();
  return {
    ...original,
    authClient: {
      getSession: clientMocks.getSession,
      signOut: clientMocks.signOut,
    },
  };
});

import {
  AuthProvider,
  mapAuthSession,
  mapAuthUser,
  useAuth,
  type AuthContextValue,
} from "@/hooks/useAuth";
import type { AuthClientSession, AuthClientUser } from "@/lib/authClient";
import { queryClient } from "@/lib/queryClient";

const user = {
  createdAt: new Date("2026-08-01T10:00:00.000Z"),
  email: "bewoner@example.com",
  emailVerified: true,
  id: "auth-user-1",
  image: "https://cdn.buildy.test/avatar.webp",
  name: "Bewoner",
  updatedAt: new Date("2026-08-02T10:00:00.000Z"),
} satisfies AuthClientUser;

const session = {
  createdAt: new Date("2026-08-01T10:00:00.000Z"),
  expiresAt: new Date("2026-08-08T10:00:00.000Z"),
  id: "11111111-1111-4111-8111-111111111111",
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  userId: user.id,
} satisfies AuthClientSession;

describe("AuthProvider", () => {
  beforeEach(() => {
    queryClient.clear();
    clientMocks.getSession.mockReset().mockResolvedValue({ session, user });
    clientMocks.signOut.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the Google user to the temporary legacy metadata contract", () => {
    expect(mapAuthUser(user)).toMatchObject({
      email: "bewoner@example.com",
      user_metadata: {
        avatar_url: "https://cdn.buildy.test/avatar.webp",
        display_name: "Bewoner",
        full_name: "Bewoner",
      },
    });
  });

  it("exposes only non-secret session metadata", () => {
    expect(mapAuthSession(session)).toEqual(session);
    expect(mapAuthSession(session)).not.toHaveProperty("token");
  });

  it("loads the cookie session and checks it again after sign-out", async () => {
    let context: AuthContextValue | undefined;
    const Probe = () => {
      context = useAuth();
      return (
        <button type="button" onClick={() => void context?.signOut()}>
          {context.user?.email ?? "uitgelogd"}
        </button>
      );
    };

    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByRole("button", { name: "bewoner@example.com" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await waitFor(() => expect(clientMocks.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clientMocks.getSession).toHaveBeenCalledTimes(2));
  });

  it("reports a failed sign-out and retains the refreshed server session", async () => {
    clientMocks.signOut.mockRejectedValueOnce(new Error("logout unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let result: boolean | undefined;
    const Probe = () => {
      const auth = useAuth();
      return (
        <button type="button" onClick={async () => { result = await auth.signOut(); }}>
          {auth.user?.email ?? "uitgelogd"}
        </button>
      );
    };

    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByRole("button", { name: "bewoner@example.com" });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(result).toBe(false));
    expect(screen.getByRole("button", { name: "bewoner@example.com" })).toBeInTheDocument();
    expect(clientMocks.getSession).toHaveBeenCalledTimes(2);
  });

  it("accepts an anonymous refresh after a lost sign-out response", async () => {
    clientMocks.getSession
      .mockResolvedValueOnce({ session, user })
      .mockResolvedValueOnce({ session: null, user: null });
    clientMocks.signOut.mockRejectedValueOnce(new Error("logout response lost"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let result: boolean | undefined;
    const Probe = () => {
      const auth = useAuth();
      return (
        <button type="button" onClick={async () => { result = await auth.signOut(); }}>
          {auth.user?.email ?? "uitgelogd"}
        </button>
      );
    };

    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByRole("button", { name: "bewoner@example.com" });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(result).toBe(true));
    expect(screen.getByRole("button", { name: "uitgelogd" })).toBeInTheDocument();
  });

  it("retains the known session when sign-out and its verification both fail", async () => {
    clientMocks.getSession
      .mockResolvedValueOnce({ session, user })
      .mockRejectedValueOnce(new Error("session verification unavailable"));
    clientMocks.signOut.mockRejectedValueOnce(new Error("logout unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let result: boolean | undefined;
    const Probe = () => {
      const auth = useAuth();
      return (
        <button type="button" onClick={async () => { result = await auth.signOut(); }}>
          {auth.user?.email ?? "uitgelogd"}
        </button>
      );
    };

    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByRole("button", { name: "bewoner@example.com" });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(result).toBe(false));
    expect(screen.getByRole("button", { name: "bewoner@example.com" })).toBeInTheDocument();
  });

  it("slaat iedere authrequest over wanneer de server de openbare demo activeert", async () => {
    const Probe = () => {
      const auth = useAuth();
      return <p>{auth.loading ? "laden" : auth.user ? "ingelogd" : "demo"}</p>;
    };

    render(<AuthProvider enabled={false}><Probe /></AuthProvider>);

    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(clientMocks.getSession).not.toHaveBeenCalled();
    expect(clientMocks.signOut).not.toHaveBeenCalled();
  });

  it("clears cached DTOs when a refreshed identity changes", async () => {
    clientMocks.getSession
      .mockResolvedValueOnce({ session, user })
      .mockResolvedValueOnce({
        session: { ...session, userId: "auth-user-2" },
        user: { ...user, id: "auth-user-2", email: "ander@example.com" },
      });
    const publicProfile = { profile: "feedback_beta" };
    queryClient.setQueryData(["private", "actor"], { secret: true });
    queryClient.setQueryData(["product", "profile"], publicProfile);
    const Probe = () => {
      const auth = useAuth();
      return (
        <button type="button" onClick={() => void auth.refetchSession()}>
          {auth.user?.email ?? "laden"}
        </button>
      );
    };

    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByRole("button", { name: "bewoner@example.com" });
    fireEvent.click(screen.getByRole("button"));

    await screen.findByRole("button", { name: "ander@example.com" });
    await waitFor(() => expect(queryClient.getQueryData(["private", "actor"])).toBeUndefined());
    expect(queryClient.getQueryData(["product", "profile"])).toEqual(publicProfile);
  });
});
