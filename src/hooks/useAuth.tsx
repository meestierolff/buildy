import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  authClient,
  authErrorDetails,
  authErrorMessage,
  type AuthClientSession,
  type AuthClientUser,
  type AuthSessionData,
} from "@/lib/authClient";
import { clearIdentityScopedQueryData } from "@/lib/queryClient";
import { toast } from "sonner";

export interface AuthUserMetadata {
  avatar_url?: string;
  display_name: string;
  full_name: string;
}

/** Compatibility shape for UI that still reads Supabase-style metadata. */
export type AuthUser = AuthClientUser & {
  user_metadata: AuthUserMetadata;
};

export type AuthSession = AuthClientSession;

export interface AuthContextValue {
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
  refetchSession: () => Promise<AuthSessionData | undefined>;
  session: AuthSession | null;
  signOut: () => Promise<boolean>;
  user: AuthUser | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function mapAuthUser(user: AuthClientUser): AuthUser {
  const displayName = user.name.trim();
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
  return { ...session };
}

export const AuthProvider = ({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) => {
  const [data, setData] = useState<AuthSessionData>({ session: null, user: null });
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const requestSequence = useRef(0);
  const previousIdentity = useRef<string | null | undefined>(undefined);

  const refetchSession = useCallback(async () => {
    if (!enabled) {
      setData({ session: null, user: null });
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return { session: null, user: null };
    }
    const sequence = ++requestSequence.current;
    setRefreshing(true);
    try {
      const next = await authClient.getSession();
      if (requestSequence.current !== sequence) return;
      setData(next);
      setError(null);
      return next;
    } catch (cause) {
      if (requestSequence.current !== sequence) return;
      setError(cause instanceof Error ? cause : new Error("Sessiecontrole mislukt."));
      return undefined;
    } finally {
      if (requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      requestSequence.current += 1;
      setData({ session: null, user: null });
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return undefined;
    }
    void refetchSession();
    const interval = window.setInterval(() => void refetchSession(), 5 * 60 * 1_000);
    const onFocus = () => void refetchSession();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      requestSequence.current += 1;
    };
  }, [enabled, refetchSession]);

  useEffect(() => {
    if (loading) return;
    const currentIdentity = data.user?.id ?? null;
    if (
      previousIdentity.current !== undefined
      && previousIdentity.current !== currentIdentity
    ) clearIdentityScopedQueryData();
    previousIdentity.current = currentIdentity;
  }, [data.user?.id, loading]);

  const user = useMemo(() => data.user ? mapAuthUser(data.user) : null, [data.user]);
  const session = useMemo(
    () => data.session ? mapAuthSession(data.session) : null,
    [data.session],
  );
  const signOut = useCallback(async () => {
    if (!enabled) return true;
    let signedOut = false;
    try {
      await authClient.signOut();
      setData({ session: null, user: null });
      setError(null);
      clearIdentityScopedQueryData();
      signedOut = true;
    } catch (cause) {
      console.error("Sign-out failed", authErrorDetails(cause));
      toast.error(authErrorMessage(cause, "sign-out"));
    } finally {
      const refreshed = await refetchSession();
      if (refreshed && !refreshed.session && !refreshed.user) signedOut = true;
    }
    return signedOut;
  }, [enabled, refetchSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      error,
      loading,
      refreshing,
      refetchSession,
      session,
      signOut,
      user,
    }),
    [error, loading, refreshing, refetchSession, session, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth moet binnen AuthProvider worden gebruikt.");
  return context;
}
