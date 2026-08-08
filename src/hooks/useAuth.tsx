import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  authClient,
  authErrorDetails,
  authErrorMessage,
  type AuthClientSession,
  type AuthClientUser,
} from "@/lib/authClient";
import { queryClient } from "@/lib/queryClient";
import { toast } from "sonner";

export interface AuthUserMetadata {
  avatar_url?: string;
  display_name: string;
  full_name: string;
}

/**
 * Compatibility shape for the remaining legacy UI. It intentionally contains
 * no provider-specific auth fields and no bearer/session token.
 */
export type AuthUser = AuthClientUser & {
  user_metadata: AuthUserMetadata;
};

export type AuthSession = Omit<AuthClientSession, "token">;

export interface AuthContextValue {
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
  refetchSession: () => Promise<void>;
  session: AuthSession | null;
  signOut: () => Promise<void>;
  user: AuthUser | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function mapAuthUser(user: AuthClientUser): AuthUser {
  const displayName = user.name?.trim() || "";
  return {
    ...user,
    user_metadata: {
      ...(user.image ? { avatar_url: user.image } : {}),
      display_name: displayName,
      full_name: displayName,
    },
  };
}

export function mapAuthSession(session: AuthClientSession): AuthSession {
  const { token: _token, ...safeSession } = session;
  return safeSession;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { data, error, isPending, isRefetching, refetch } = authClient.useSession();
  const previousIdentity = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isPending) return;
    const currentIdentity = data?.user.id ?? null;
    if (
      previousIdentity.current !== undefined &&
      previousIdentity.current !== currentIdentity
    ) {
      // Query keys are not a security boundary, but cached private DTOs may
      // never survive a sign-out or account switch in the same browser tab.
      queryClient.clear();
    }
    previousIdentity.current = currentIdentity;
  }, [data?.user.id, isPending]);

  const user = useMemo(() => data?.user ? mapAuthUser(data.user) : null, [data?.user]);
  const session = useMemo(
    () => data?.session ? mapAuthSession(data.session) : null,
    [data?.session],
  );
  const refetchSession = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const signOut = useCallback(async () => {
    try {
      const result = await authClient.signOut();
      if (result.error) {
        console.error("Better Auth sign-out failed", authErrorDetails(result.error));
        toast.error(authErrorMessage(result.error, "sign-out"));
      }
    } catch (error) {
      console.error("Better Auth sign-out failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "sign-out"));
    } finally {
      await refetch();
    }
  }, [refetch]);

  const value = useMemo<AuthContextValue>(
    () => ({
      error,
      loading: isPending,
      refreshing: isRefetching,
      refetchSession,
      session,
      signOut,
      user,
    }),
    [error, isPending, isRefetching, refetchSession, session, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth moet binnen AuthProvider worden gebruikt.");
  return context;
}
