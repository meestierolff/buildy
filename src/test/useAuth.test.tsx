import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  refetch: vi.fn<() => Promise<void>>(),
  signOut: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/lib/authClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/authClient")>();
  return {
    ...original,
    authClient: {
      signOut: clientMocks.signOut,
      useSession: clientMocks.useSession,
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
  id: "session-1",
  token: "must-not-reach-context",
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  userId: user.id,
} satisfies AuthClientSession;

describe("AuthProvider", () => {
  beforeEach(() => {
    clientMocks.refetch.mockReset().mockResolvedValue(undefined);
    clientMocks.signOut.mockReset().mockResolvedValue({ data: { success: true }, error: null });
    clientMocks.useSession.mockReset().mockReturnValue({
      data: { session, user },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: clientMocks.refetch,
    });
  });

  it("maps Better Auth users to the temporary legacy metadata contract", () => {
    expect(mapAuthUser(user)).toMatchObject({
      email: "bewoner@example.com",
      user_metadata: {
        avatar_url: "https://cdn.buildy.test/avatar.webp",
        display_name: "Bewoner",
        full_name: "Bewoner",
      },
    });
  });

  it("removes the bearer-equivalent session token from context", () => {
    expect(mapAuthSession(session)).not.toHaveProperty("token");
  });

  it("exposes the cookie session and refetches after sign-out", async () => {
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
    expect(screen.getByRole("button", { name: "bewoner@example.com" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await waitFor(() => expect(clientMocks.signOut).toHaveBeenCalledTimes(1));
    expect(clientMocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("clears cached DTOs when the authenticated identity changes", async () => {
    const clear = vi.spyOn(queryClient, "clear");
    const { rerender } = render(<AuthProvider><span>inhoud</span></AuthProvider>);

    clientMocks.useSession.mockReturnValue({
      data: {
        session: { ...session, userId: "auth-user-2" },
        user: { ...user, id: "auth-user-2", email: "ander@example.com" },
      },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: clientMocks.refetch,
    });
    rerender(<AuthProvider><span>inhoud</span></AuthProvider>);

    await waitFor(() => expect(clear).toHaveBeenCalledOnce());
  });
});
