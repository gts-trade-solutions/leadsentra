"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  Users,
  Coins,
  Wallet,
  BarChart3,
  Plus,
  Trash2,
  ShieldCheck,
  Mail,
  Lock,
  KeyRound,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import StatCard from "@/components/StatCard";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/hooks/use-toast";

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "moderator" | "admin";
  email_verified: number | boolean;
  created_at: string;
  balance: number;
};

type PriceRow = { feature: string; price: number };

type Stats = {
  users: number;
  admins: number;
  moderators: number;
  companies: number;
  contacts: number;
  suppressions: number;
  campaigns: number;
  sent_30d: number;
};

type TopWallet = { id: string; email: string; role: string; balance: number };

type Tab = "overview" | "users" | "prices" | "topup" | "campaign";

export default function PlatformAdmin() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("overview");

  // Admin-only page.  Moderators get the global credit bypass but no UI here.
  if (user && !isAdmin) {
    return (
      <AuthGuard>
        <div className="rounded-2xl border border-red-800/60 bg-red-950/30 p-8 text-center">
          <Shield className="w-10 h-10 mx-auto text-red-400 mb-3" />
          <h1 className="text-xl font-semibold text-white">Admin access required</h1>
          <p className="text-sm text-gray-400 mt-2">
            This page is restricted to platform admins.
            {user.role === "moderator" && (
              <>
                {" "}As a moderator you already have credit-free access across the app —
                no panel needed.
              </>
            )}
          </p>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="space-y-6">
        <SectionHeader
          title="Platform Admin"
          description="Users, credits, prices, and admin campaign tools"
        >
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-emerald-900/30 text-emerald-200 border border-emerald-700">
            <ShieldCheck className="w-3.5 h-3.5" />
            {user?.role}
          </span>
        </SectionHeader>

        {/* Tabs */}
        <nav className="flex flex-wrap gap-1 border-b border-gray-800" role="tablist">
          <TabButton id="overview" current={tab} onClick={setTab} icon={BarChart3} label="Overview" />
          <TabButton id="users"    current={tab} onClick={setTab} icon={Users}     label="Users" />
          {isAdmin && (
            <TabButton id="prices" current={tab} onClick={setTab} icon={Coins}    label="Credit prices" />
          )}
          {isAdmin && (
            <TabButton id="topup"  current={tab} onClick={setTab} icon={Wallet}   label="Top up" />
          )}
          <TabButton id="campaign" current={tab} onClick={setTab} icon={Mail}     label="Admin campaign" />
        </nav>

        {tab === "overview" && <OverviewTab />}
        {tab === "users"    && <UsersTab isAdmin={isAdmin} />}
        {tab === "prices" && isAdmin && <PricesTab />}
        {tab === "topup"  && isAdmin && <TopUpTab />}
        {tab === "campaign" && <AdminCampaignTab />}
      </div>
    </AuthGuard>
  );
}

function TabButton({
  id, current, onClick, icon: Icon, label,
}: {
  id: Tab; current: Tab; onClick: (t: Tab) => void; icon: any; label: string;
}) {
  const active = current === id;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
      className={`relative px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-colors
        ${active ? "text-emerald-400" : "text-gray-300 hover:text-white"}`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {active && (
        <span className="absolute inset-x-3 -bottom-px h-0.5 bg-emerald-400 rounded-full" />
      )}
    </button>
  );
}

// =============================================================================
// Overview tab
// =============================================================================
function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [topWallets, setTopWallets] = useState<TopWallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/stats", { credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        setStats(data?.stats || null);
        setTopWallets(Array.isArray(data?.topWallets) ? data.topWallets : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-sm text-gray-400">Loading stats…</div>;
  if (!stats)  return <div className="text-sm text-red-300">Failed to load stats.</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Users"        value={stats.users.toLocaleString()}        icon={Users} />
        <StatCard title="Admins"       value={stats.admins.toLocaleString()}       icon={Shield} />
        <StatCard title="Moderators"   value={stats.moderators.toLocaleString()}   icon={ShieldCheck} />
        <StatCard title="Companies"    value={stats.companies.toLocaleString()}    icon={BarChart3} />
        <StatCard title="Contacts"     value={stats.contacts.toLocaleString()}     icon={Users} />
        <StatCard title="Suppressions" value={stats.suppressions.toLocaleString()} icon={Lock} />
        <StatCard title="Campaigns"    value={stats.campaigns.toLocaleString()}    icon={Mail} />
        <StatCard title="Delivered 30d" value={stats.sent_30d.toLocaleString()}    icon={Mail} />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Top wallets</h2>
        </div>
        {topWallets.length === 0 ? (
          <div className="text-sm text-gray-400">No wallets yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-right px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {topWallets.map((w) => (
                <tr key={w.id} className="text-gray-200">
                  <td className="px-3 py-2 break-all">{w.email}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs uppercase tracking-wider">{w.role}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(w.balance).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Users tab
// =============================================================================
function UsersTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // Per-moderator page-access editor target. null = closed.
  const [accessTarget, setAccessTarget] = useState<UserRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const u = new URL("/api/admin/users", window.location.origin);
      if (search) u.searchParams.set("q", search);
      if (roleFilter !== "all") u.searchParams.set("role", roleFilter);
      const res = await fetch(u.toString(), { credentials: "same-origin", cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      setRows(Array.isArray(d?.users) ? d.users : []);
      setTotal(Number(d?.total || 0));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter]);

  async function changeRole(u: UserRow, role: string) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ role }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ variant: "destructive", title: "Update failed", description: d?.error || "" });
      return;
    }
    toast({ title: `Role changed to ${role}` });
    load();
  }

  async function remove(u: UserRow) {
    if (!confirm(`Permanently delete ${u.email} and all their data?`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ variant: "destructive", title: "Delete failed", description: d?.error || "" });
      return;
    }
    toast({ title: "User deleted" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3">
          <div>
            <label htmlFor="ua-q" className="block text-xs text-gray-400 mb-1">Search</label>
            <input
              id="ua-q"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="email or name…"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
            />
          </div>
          <div>
            <label htmlFor="ua-role" className="block text-xs text-gray-400 mb-1">Role</label>
            <select
              id="ua-role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
            >
              <option value="all">All</option>
              <option value="user">user</option>
              <option value="moderator">moderator</option>
              <option value="admin">admin</option>
            </select>
          </div>
          {isAdmin && (
            <div className="self-end">
              <button
                onClick={() => setShowCreate(true)}
                className="h-[42px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Create moderator
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/80 text-gray-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Verified</th>
              <th className="text-right px-3 py-2">Balance</th>
              <th className="text-left px-3 py-2">Created</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-4 text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-4 text-gray-400">No users.</td></tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="text-gray-200">
                  <td className="px-3 py-2 break-all">{u.email}</td>
                  <td className="px-3 py-2 text-gray-400">{u.full_name || "—"}</td>
                  <td className="px-3 py-2">
                    {isAdmin ? (
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200"
                      >
                        <option value="user">user</option>
                        <option value="moderator">moderator</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : (
                      <span className="text-xs uppercase tracking-wider text-gray-400">{u.role}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs ${u.email_verified ? "text-emerald-300" : "text-amber-300"}`}>
                      {u.email_verified ? "yes" : "no"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{Number(u.balance || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {isAdmin && u.role === "moderator" && (
                        <button
                          onClick={() => setAccessTarget(u)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-emerald-700 hover:text-emerald-200 text-gray-200"
                          title="Set which portal pages this moderator can access"
                        >
                          <KeyRound className="w-3.5 h-3.5" /> Access
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => remove(u)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-red-900/40 hover:border-red-700 text-gray-200 hover:text-red-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-500">{total.toLocaleString()} users total</div>

      {showCreate && <CreateUserModal onClose={() => { setShowCreate(false); load(); }} />}
      {accessTarget && (
        <PageAccessModal
          target={accessTarget}
          onClose={() => setAccessTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * PageAccessModal — admin-only editor for which portal pages a moderator can
 * see. Mirrors the `pages` JSON stored in `moderator_page_access`. A null
 * server value means "no override yet → allow everything".
 */
function PageAccessModal({
  target,
  onClose,
}: {
  target: UserRow;
  onClose: () => void;
}) {
  type Page = { key: string; label: string };
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allPages, setAllPages] = useState<Page[]>([]);
  // null = use defaults (allow all); array = explicit allowlist.
  const [pages, setPages] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/admin/moderators/${target.id}/page-access`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "Failed to load");
        if (cancelled) return;
        setAllPages(Array.isArray(j?.all_pages) ? j.all_pages : []);
        setPages(Array.isArray(j?.pages) ? j.pages : null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target.id]);

  const usingDefaults = pages === null;
  const currentSet = new Set(pages ?? allPages.map((p) => p.key));

  function togglePage(key: string) {
    // First toggle from "inherit all" promotes the state to an explicit
    // allowlist seeded with every page, then flips the one the user clicked.
    setPages((prev) => {
      const base = prev ?? allPages.map((p) => p.key);
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return Array.from(next);
    });
  }

  async function save(reset: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/moderators/${target.id}/page-access`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(reset ? { reset: true } : { pages: pages ?? [] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Save failed");
      toast({ title: "Page access updated", description: target.email });
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Moderator page access</h2>
          <p className="text-xs text-gray-400 mt-1 break-all">{target.email}</p>
        </div>

        {err && (
          <div className="text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
            {err}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          <>
            <p className="text-xs text-gray-400">
              {usingDefaults
                ? "No override set — this moderator can access every portal page. Tick boxes to restrict."
                : "Tick the pages this moderator is allowed to open."}
            </p>
            <ul className="space-y-2">
              {allPages.map((p) => (
                <li key={p.key}>
                  <label className="flex items-center gap-2 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={currentSet.has(p.key)}
                      onChange={() => togglePage(p.key)}
                    />
                    <span>{p.label}</span>
                    <span className="text-xs text-gray-500">/{p.key}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <button
            onClick={() => save(true)}
            disabled={busy || loading}
            className="px-3 py-2 rounded-lg text-sm border border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-600 disabled:opacity-60"
            title="Remove the override — moderator will see every page again"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-sm border border-gray-700 bg-gray-800 text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => save(false)}
              disabled={busy || loading}
              className="px-3 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"moderator" | "admin">("moderator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, full_name: fullName || undefined, role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error || "Failed to create");
        return;
      }
      toast({ title: `Created ${role}`, description: email });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white">Create staff account</h2>
        {err && (
          <div className="text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">{err}</div>
        )}
        <div>
          <label htmlFor="cu-email" className="block text-sm text-gray-300 mb-1">Email</label>
          <input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200" />
        </div>
        <div>
          <label htmlFor="cu-name" className="block text-sm text-gray-300 mb-1">Full name (optional)</label>
          <input id="cu-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200" />
        </div>
        <div>
          <label htmlFor="cu-pw" className="block text-sm text-gray-300 mb-1">Temporary password</label>
          <input id="cu-pw" type="text" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 12 chars, mixed case + number"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 font-mono text-sm" />
          <p className="text-xs text-gray-500 mt-1">
            Share this with the new staff member out of band. They can change it after first login.
          </p>
        </div>
        <div>
          <label htmlFor="cu-role" className="block text-sm text-gray-300 mb-1">Role</label>
          <select id="cu-role" value={role} onChange={(e) => setRole(e.target.value as any)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200">
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm border border-gray-700 bg-gray-800 text-gray-200">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !email || !password}
            className="px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Prices tab
// =============================================================================
function PricesTab() {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/credits/prices", { credentials: "same-origin" });
      const d = await res.json().catch(() => ({}));
      const list: PriceRow[] = Array.isArray(d?.prices) ? d.prices : [];
      setRows(list);
      const e: Record<string, string> = {};
      for (const r of list) e[r.feature] = String(r.price);
      setEdits(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const changes = rows
      .filter((r) => String(r.price) !== edits[r.feature])
      .map((r) => ({ feature: r.feature, price: Number(edits[r.feature]) }))
      .filter((r) => Number.isFinite(r.price) && r.price >= 0);
    if (!changes.length) {
      toast({ title: "Nothing to save" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/credits/prices", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ prices: changes }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "Save failed", description: d?.error || "" });
        return;
      }
      toast({ title: `Updated ${d.updated} prices` });
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/80 text-gray-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-3 py-2">Feature</th>
              <th className="text-right px-3 py-2">Current</th>
              <th className="text-right px-3 py-2">New price (credits)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-4 text-gray-400">Loading…</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.feature} className="text-gray-200">
                  <td className="px-3 py-2 font-mono">{r.feature}</td>
                  <td className="px-3 py-2 text-right text-gray-400 font-mono">{r.price}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      value={edits[r.feature] ?? ""}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, [r.feature]: e.target.value }))
                      }
                      className="w-24 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-right font-mono"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Top-up tab
// =============================================================================
function TopUpTab() {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [picked, setPicked] = useState<UserRow | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!search.trim()) { setUsers([]); return; }
      const u = new URL("/api/admin/users", window.location.origin);
      u.searchParams.set("q", search);
      u.searchParams.set("limit", "10");
      const res = await fetch(u.toString(), { credentials: "same-origin", cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      setUsers(Array.isArray(d?.users) ? d.users : []);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  async function apply() {
    if (!picked) return;
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt === 0) {
      toast({ variant: "destructive", title: "Amount must be a non-zero integer" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/credits/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ user_id: picked.id, amount: amt, note: note || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "Top-up failed", description: d?.error || "" });
        return;
      }
      toast({ title: amt > 0 ? `Credited ${amt}` : `Clawed back ${-amt}`, description: `New balance: ${d.balance}` });
      setAmount(""); setNote("");
      setPicked({ ...picked, balance: d.balance });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Find user</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name…"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
        />
        {users.length > 0 && (
          <ul className="rounded-lg border border-gray-800 divide-y divide-gray-800 overflow-hidden">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => setPicked(u)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-800 ${picked?.id === u.id ? "bg-gray-800" : ""}`}
                >
                  <div className="text-gray-200">{u.full_name || u.email}</div>
                  <div className="text-xs text-gray-500">{u.email} · {u.role} · balance {u.balance}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Top up</h2>
        {!picked ? (
          <p className="text-sm text-gray-400">Pick a user on the left to top up.</p>
        ) : (
          <>
            <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3 text-sm">
              <div className="text-gray-200">{picked.email}</div>
              <div className="text-xs text-gray-500">
                Current balance: <b className="text-white font-mono">{picked.balance.toLocaleString()}</b>
              </div>
            </div>
            <div>
              <label htmlFor="tu-amt" className="block text-xs text-gray-400 mb-1">
                Amount (credits) — negative to claw back
              </label>
              <input
                id="tu-amt"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 100 or -50"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 font-mono"
              />
            </div>
            <div>
              <label htmlFor="tu-note" className="block text-xs text-gray-400 mb-1">Note (optional)</label>
              <input
                id="tu-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. promo / refund / chargeback"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              />
            </div>
            <button
              onClick={apply}
              disabled={busy || !amount}
              className="w-full px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
            >
              {busy ? "Applying…" : "Apply"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Admin campaign tab — opens the existing compose flow in admin mode
// =============================================================================
function AdminCampaignTab() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-300 space-y-4">
      <div className="flex items-center gap-2 text-white">
        <Mail className="w-5 h-5 text-emerald-400" />
        <h2 className="font-semibold">Admin campaign send</h2>
      </div>
      <div className="text-gray-400 space-y-2">
        <p>
          Use the standard compose page in <b className="text-white">admin mode</b> — it lets you target{" "}
          <b className="text-white">every contact</b> in the database (not just unlocked ones), and{" "}
          <b className="text-white">does not charge credits</b>.
        </p>
        <ul className="list-disc list-inside text-xs text-gray-500 space-y-0.5">
          <li>Audience source: all contacts with valid emails.</li>
          <li>Suppression list still applies (compliance — bounces / complaints / unsubscribes).</li>
          <li>Campaign appears in the normal Email Campaigns list, tagged as admin-bypass.</li>
        </ul>
      </div>
      <Link
        href="/portal/campaigns/new?admin=1"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
      >
        <Mail className="w-4 h-4" />
        Open admin compose
      </Link>
    </div>
  );
}
