'use client';

import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useOptionalAuth } from '@/components/AuthProvider';

/**
 * Renders children only once the AuthProvider confirms a user is signed in.
 * Falls back to a one-shot /api/auth/me fetch if it's mounted outside the
 * provider (kept for safety; the portal layout wraps this in AuthProvider).
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useOptionalAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const full = pathname + (search?.toString() ? `?${search.toString()}` : '');
      router.replace(`/auth/signin?next=${encodeURIComponent(full)}`);
    }
  }, [user, loading, pathname, search, router]);

  if (loading || !user) {
    return (
      <div className="min-h-[50vh] grid place-items-center text-gray-400">
        Checking authentication…
      </div>
    );
  }

  return <>{children}</>;
}
