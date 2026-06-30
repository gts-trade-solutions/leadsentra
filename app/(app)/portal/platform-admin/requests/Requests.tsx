"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X, RefreshCcw, Building2, Clock } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";

type ReqRow = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  company_id: string;
  company_name: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
};

type Filter = "pending" | "approved" | "rejected" | "all";

export default function CompanyRequests() {
  const router = useRouter();
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/company-requests?status=${filter}`, { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      setRows(Array.isArray(json?.data) ? json.data : []);
      setPending(Number(json?.pending) || 0);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(row: ReqRow, action: "approve" | "reject") {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/company-requests/${row.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      toast({ title: action === "approve" ? "Approved" : "Rejected", description: `${row.user_email} → ${row.company_name}` });
      load();
    } catch (e: any) {
      toast({ title: "Could not update", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  const TABS: Filter[] = ["pending", "approved", "rejected", "all"];

  return (
    <AuthGuard>
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => router.push("/portal/platform-admin")} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Platform Admin
        </button>
        <SectionHeader title="Company Join Requests" description="Approve or reject users requesting access to a company.">
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
            <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </SectionHeader>

        <div className="flex items-center gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${
                filter === t ? "bg-emerald-600 border-emerald-600 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
              }`}
            >
              {t}
              {t === "pending" && pending > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500 text-black">{pending}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            No {filter === "all" ? "" : filter} requests.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-gray-200">
                      <div className="font-medium text-white">{r.user_name || r.user_email}</div>
                      {r.user_name && <div className="text-xs text-gray-500">{r.user_email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-200">
                      <span className="inline-flex items-center gap-1.5"><Building2 className="w-4 h-4 text-gray-500" />{r.company_name}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmt(r.requested_at)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {r.status !== "approved" && (
                          <button onClick={() => decide(r, "approve")} disabled={busyId === r.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs disabled:opacity-50">
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                        )}
                        {r.status !== "rejected" && (
                          <button onClick={() => decide(r, "reject")} disabled={busyId === r.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-rose-900/40 hover:border-rose-700 text-gray-200 hover:text-rose-200 text-xs disabled:opacity-50">
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
  return d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
