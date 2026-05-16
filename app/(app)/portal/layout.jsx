import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { AuthProvider } from '@/components/AuthProvider';
import { JobsProvider } from '@/components/JobsProvider';
import { JobsBar } from '@/components/JobsBar';

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
                {children}
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
