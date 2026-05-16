import Link from "next/link";
import { ArrowLeft, LayoutDashboard, LogIn } from "lucide-react";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 grid place-items-center px-4">
      <div className="max-w-md w-full text-center">
        <p className="text-emerald-400 text-sm tracking-widest font-medium">
          ERROR 404
        </p>
        <h1 className="mt-2 text-4xl sm:text-5xl font-bold text-white">
          Page not found
        </h1>
        <p className="mt-3 text-gray-400">
          The page you were looking for has moved, never existed, or you
          followed a stale link.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/portal/companies"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          >
            <LayoutDashboard className="w-4 h-4" />
            Go to dashboard
          </Link>
          <Link
            href="/auth/signin"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm font-medium"
          >
            <LogIn className="w-4 h-4" />
            Sign in
          </Link>
        </div>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
