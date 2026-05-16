"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
  email_verified?: boolean | number | null;
} | null;

type AuthCtx = {
  user: AuthUser;
  loading: boolean;
  /** Force a fresh fetch of /api/auth/me. */
  refresh: () => Promise<void>;
  /** POSTs /api/auth/logout, wipes sb-/recentlyViewed/rzp localStorage, hard-redirects. */
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const REVALIDATE_MS = 5 * 60_000; // 5 minutes

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const lastFetched = useRef<number>(0);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    // De-dupe overlapping fetches
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        setUser(data?.user ?? null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
        lastFetched.current = Date.now();
      }
    })();
    inflight.current = p;
    try {
      await p;
    } finally {
      inflight.current = null;
    }
  }, []);

  // initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Revalidate when the tab regains focus, but only if our cache is stale
  useEffect(() => {
    function onFocus() {
      if (Date.now() - lastFetched.current > REVALIDATE_MS) {
        refresh();
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore
    }
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("sb-") || k === "recentlyViewed" || k.startsWith("rzp")) {
          localStorage.removeItem(k);
        }
      });
    } catch {
      // ignore
    }
    setUser(null);
    window.location.href = "/auth/signin?signedout=1";
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useAuth() must be used inside <AuthProvider>. Wrap your route's layout in it."
    );
  }
  return v;
}

/**
 * Same shape as useAuth(), but returns nulls instead of throwing.
 * Useful for components that may render outside the portal layout
 * (e.g. the marketing site).
 */
export function useOptionalAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    user: null,
    loading: false,
    refresh: async () => {},
    signOut: async () => {
      window.location.href = "/auth/signin?signedout=1";
    },
  };
}
