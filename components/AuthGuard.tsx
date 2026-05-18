'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useOptionalAuth } from '@/components/AuthProvider';

// NOTE: we deliberately do NOT import `useSearchParams` here. It forces every
// page wrapped in AuthGuard to bail out of static prerendering unless it sits
// inside a <Suspense> boundary (Next.js 14 rule). Since AuthGuard is mounted
// at the portal layout level, that would break the whole portal build. The
// effect below only runs in the browser, so reading `window.location.search`
// gives us the exact same redirect behaviour with no prerender cost.

/**
 * Maps a portal pathname to its top-level page key, used by the
 * moderator_page_access allowlist. Pages outside this map (e.g.
 * /portal/share-close, /portal/platform-admin) are not gated here —
 * platform-admin has its own admin-only guard inside the component.
 */
function pageKeyFor(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/portal\/([^/]+)/);
  if (!m) return null;
  const key = m[1];
  const known = new Set(["contacts", "companies", "campaigns", "multi-channel"]);
  return known.has(key) ? key : null;
}

/**
 * Renders children only once the AuthProvider confirms a user is signed in.
 * Additionally enforces the per-moderator page allowlist set in the Platform
 * Admin UI — moderators land on /portal/contacts if they hit a page they no
 * longer have access to.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useOptionalAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Read the current query string straight from the browser — the effect
      // is client-only, so window.location is always defined here.
      const qs = typeof window !== 'undefined' ? window.location.search : '';
      const full = (pathname || '') + qs;
      router.replace(`/auth/signin?next=${encodeURIComponent(full)}`);
      return;
    }
    // Moderator page allowlist enforcement.  page_access is attached by
    // /api/auth/me: null = inherit (allow all); array = explicit allowlist.
    if (user.role === 'moderator') {
      const allow = (user as any).page_access as string[] | null | undefined;
      if (Array.isArray(allow)) {
        const key = pageKeyFor(pathname);
        if (key && !allow.includes(key)) {
          // Send to the first allowed page, or a friendly notice if nothing
          // is allowed (admins can still talk to them on Slack / email).
          const fallback = allow[0] ? `/portal/${allow[0]}` : '/portal/share-close';
          router.replace(fallback);
        }
      }
    }
  }, [user, loading, pathname, router]);

  if (loading || !user) {
    return (
      <div className="min-h-[50vh] grid place-items-center text-gray-400">
        Checking authentication…
      </div>
    );
  }

  // Hold rendering while a moderator-page redirect is in flight, so the
  // restricted page never flashes its content before the router navigates.
  if (user.role === 'moderator') {
    const allow = (user as any).page_access as string[] | null | undefined;
    if (Array.isArray(allow)) {
      const key = pageKeyFor(pathname);
      if (key && !allow.includes(key)) {
        return (
          <div className="min-h-[50vh] grid place-items-center text-gray-400">
            Redirecting…
          </div>
        );
      }
    }
  }

  return <>{children}</>;
}
