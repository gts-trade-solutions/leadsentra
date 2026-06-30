"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Check, Clock, X, Plus, RefreshCcw, ShieldCheck } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { useOptionalAuth } from "@/components/AuthProvider";
import { toast } from "@/hooks/use-toast";

type Membership = {
  id: string;
  company_id: string;
  company_name: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  requested_at: string;
  decided_at: string | null;
};
type CompanyOpt = { company_id: string; name: string };

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";

export default function CompanyAccess() {
  const { user } = useOptionalAuth();
  const isAdmin = user?.role === "admin";
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, cRes] = await Promise.all([
        fetch("/api/me/companies", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/companies/public", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const mJson = await mRes.json().catch(() => ({}));
      const cJson = await cRes.json().catch(() => ({}));
      setMemberships(Array.isArray(mJson?.data) ? mJson.data : []);
      setCompanies(Array.isArray(cJson?.data) ? cJson.data : []);
    } catch {
      setMemberships([]);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map(memberships.map((m) => [m.company_id, m])), [memberships]);

  // Companies the user can still request (no membership, or previously rejected).
  const requestable = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((c) => {
        const m = byId.get(c.company_id);
        if (m && (m.status === "approved" || m.status === "pending")) return false;
        return !q || c.name.toLowerCase().includes(q);
      })
      .slice(0, 200);
  }, [companies, byId, query]);

  async function request() {
    if (!picked) {
      toast({ title: "Pick a company", variant: "destructive" });
      return;
    }
    setRequesting(true);
    try {
      const res = await fetch("/api/me/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ company_id: picked }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Request failed");
      toast({
        title: json.status === "approved" ? "Already a member" : "Request sent",
        description: json.status === "approved" ? "You already have access." : "An admin will review your request.",
      });
      setPicked("");
      setQuery("");
      load();
    } catch (e: any) {
      toast({ title: "Could not request", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <SectionHeader title="Company Access" description="Request access to a company. Once an admin approves, you can use that company across Catalogues, Offers and more.">
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
            <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </SectionHeader>

        {isAdmin && (
          <Link
            href="/portal/platform-admin/requests"
            className="flex items-center justify-between gap-2 rounded-lg border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm hover:border-amber-500"
          >
            <span className="inline-flex items-center gap-2 text-amber-100">
              <ShieldCheck className="w-4 h-4 text-amber-300" />
              <span>
                <b>Approving requests?</b> This page shows <i>your own</i> memberships. Other users' join
                requests are reviewed under Platform Admin.
              </span>
            </span>
            <span className="whitespace-nowrap text-amber-300">Go to join requests →</span>
          </Link>
        )}

        {/* Request access */}
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Request access to a company</h2>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Search</label>
              <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a company name…" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Company</label>
              <select className={inputCls} value={picked} onChange={(e) => setPicked(e.target.value)}>
                <option value="">— Select a company —</option>
                {requestable.map((c) => (
                  <option key={c.company_id} value={c.company_id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button onClick={request} disabled={requesting || !picked} className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              <Plus className="w-4 h-4" /> {requesting ? "Sending…" : "Request"}
            </button>
          </div>
        </section>

        {/* My memberships */}
        <section className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 text-sm font-semibold text-white">Your companies</div>
          {loading ? (
            <div className="p-6 text-sm text-gray-400">Loading…</div>
          ) : memberships.length === 0 ? (
            <div className="p-6 text-sm text-gray-400">No requests yet. Request access to a company above.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-5 py-2.5 font-medium">Company</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Requested</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <tr key={m.id} className="border-b border-gray-800/60">
                    <td className="px-5 py-3 text-gray-200">
                      <span className="inline-flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-500" />{m.company_name}</span>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{fmt(m.requested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AuthGuard>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  if (status === "approved")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-900/40 text-emerald-200 border border-emerald-700"><Check className="w-3 h-3" /> Approved</span>;
  if (status === "rejected")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-rose-900/40 text-rose-200 border border-rose-700"><X className="w-3 h-3" /> Rejected</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-900/40 text-amber-200 border border-amber-700"><Clock className="w-3 h-3" /> Pending</span>;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
