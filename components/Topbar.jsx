"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { User, LogOut, Wallet as WalletIcon, RefreshCcw, Shield } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

export default function Topbar() {
  const { user, loading: loadingUser, signOut } = useAuth();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on outside click or Escape so it never lingers over page content.
  useEffect(() => {
    if (!showUserMenu) return;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setShowUserMenu(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [showUserMenu]);
  const [wallet, setWallet] = useState(null);
  const [loadingWallet, setLoadingWallet] = useState(true);

  const profile = useMemo(() => {
    if (!user) return { id: "", name: "", email: "" };
    const name =
      user.full_name || (user.email ? String(user.email).split("@")[0] : "User");
    return { id: user.id, name, email: user.email ?? "" };
  }, [user]);

  const refreshWallet = useCallback(async () => {
    setLoadingWallet(true);
    try {
      const res = await fetch("/api/wallet", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      const bal = data?.balance;
      setWallet(typeof bal === "number" ? bal : 0);
    } catch (e) {
      console.warn("wallet load failed:", e);
      setWallet(null);
    } finally {
      setLoadingWallet(false);
    }
  }, []);

  useEffect(() => {
    if (loadingUser) return;
    if (user) refreshWallet();
    else { setWallet(null); setLoadingWallet(false); }
  }, [user, loadingUser, refreshWallet]);

  const handleSignOut = () => signOut();

  const isAdmin = user?.role === "admin";

  return (
    <div className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        {isAdmin && (
          <Link
            href="/portal/platform-admin"
            prefetch={false}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
            title="Platform Admin"
          >
            <Shield className="w-4 h-4" />
            Platform Admin
          </Link>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Link
          href="/#pricing"
          prefetch={false}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
          title="Buy credits"
        >
          <WalletIcon className="w-4 h-4" />
          Buy credits
        </Link>

        <button
          type="button"
          onClick={() => refreshWallet()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600"
          title="Click to refresh"
        >
          <WalletIcon className="w-4 h-4" />
          <span className="font-medium">Credits:</span>
          <span className="tabular-nums">{loadingWallet ? "…" : wallet ?? "--"}</span>
          <RefreshCcw className="w-3 h-3 opacity-70" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={showUserMenu}
            className="flex items-center gap-3 p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <div className="w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="text-left hidden md:block max-w-[180px]">
              <div className="text-sm font-medium text-white truncate">
                {loadingUser ? "Loading…" : profile.name || "Guest"}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {loadingUser ? "" : profile.email || ""}
              </div>
            </div>
          </button>

          {showUserMenu && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-[60]"
            >
              <div className="px-4 py-2 border-b border-gray-700">
                <div className="text-sm font-medium text-white truncate">
                  {profile.name || "Guest"}
                </div>
                {profile.email ? (
                  <div className="text-xs text-gray-400 truncate">{profile.email}</div>
                ) : null}
              </div>

              <button
                onClick={handleSignOut}
                role="menuitem"
                className="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 w-full text-left"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
