import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { AuthProvider } from '@/components/AuthProvider';
import { JobsProvider } from '@/components/JobsProvider';
import { JobsBar } from '@/components/JobsBar';
import AuthGuard from '@/components/AuthGuard';

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <JobsProvider>
        <div className="flex h-screen bg-gray-950">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="max-w-7xl mx-auto">
                {/* AuthGuard at the portal root: handles sign-in redirect AND
                    the per-moderator page-access allowlist enforcement.
                    Nested AuthGuards inside individual pages stay a no-op
                    once the parent has resolved the session. */}
                <AuthGuard>{children}</AuthGuard>
              </div>
            </main>
          </div>
        </div>
        {/* Floating per-campaign send progress widgets, survive navigation */}
        <JobsBar />
      </JobsProvider>
    </AuthProvider>
  );
}
