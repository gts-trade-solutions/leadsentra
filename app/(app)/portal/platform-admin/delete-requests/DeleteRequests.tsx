"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X, RefreshCcw, Trash2, ShieldAlert, Clock } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";

/**
 * The delete queue.
 *
 * A super admin sees everyone's and decides. An admin sees only their own and
 * can read what happened to it — approving is what carries the deletion out, so
 * this screen is also the record of what was actually removed and by whose
 * decision.
 */

type Status = "pending" | "approved" | "rejected" | "failed";

type Row = {
  id: string;
  requested_by: string;
  requested_by_email: string | null;
  resource: string;
  resource_id: string;
  label: string | null;
  reason: string | null;
  status: Status;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_note: string | null;
  outcome: string | null;
  created_at: string;
  payload: Record<string, any> | null;
};

type Filter = Status | "all";

const NOUNS: Record<string, string> = {
  company: "Company",
  company_bulk: "Companies (bulk)",
  contact: "Contact",
  contact_bulk: "Contacts (bulk)",
  invoice: "Proforma invoice",
  offer: "Offer",
  order: "Order",
  catalogue: "Catalogue",
  offer_template: "Offer template",
  user: "User account",
  list_value: "List value",
};

const STATUS_STYLE: Record<Status, string> = {
  pending: "bg-amber-900/40 text-amber-300 border-amber-800",
  approved: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  rejected: "bg-gray-800 text-gray-400 border-gray-700",
  failed: "bg-red-900/40 text-red-300 border-red-800",
};

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export default function DeleteRequests() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState(0);
  const [canDecide, setCanDecide] = useState(false);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/delete-requests?status=${filter}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not load the queue");
      setRows(Array.isArray(json?.data) ? json.data : []);
      setPending(Number(json?.pending) || 0);
      setCanDecide(!!json?.can_decide);
    } catch (e: any) {
      setRows([]);
      toast({ variant: "destructive", title: "Delete requests", description: e?.message });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(row: Row, action: "approve" | "reject") {
    const what = `${NOUNS[row.resource] ?? row.resource} · ${row.label || row.resource_id}`;
    if (
      action === "approve" &&
      !confirm(
        `Approve and delete now?\n\n${what}\n\nRequested by ${
          row.requested_by_email || "an admin"
        }. Approving carries the deletion out immediately and cannot be undone.`
      )
    ) {
      return;
    }

    const note = action === "reject" ? window.prompt("Reason for rejecting (optional):") : null;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/delete-requests/${row.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, note: note || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      toast({
        title: action === "approve" ? "Deleted" : "Rejected",
        description: json?.outcome || what,
      });
      load();
    } catch (e: any) {
      // A refused approval still changed the request (to "failed"), so reload
      // rather than leaving a stale row that still offers an Approve button.
      toast({ variant: "destructive", title: "Could not complete", description: e?.message });
      load();
    } finally {
      setBusyId(null);
    }
  }

  const TABS: Filter[] = ["pending", "approved", "rejected", "failed", "all"];

  return (
    <AuthGuard>
      <div className="p-6 max-w-5xl mx-auto">
        <button
          onClick={() => router.push("/portal/platform-admin")}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Platform Admin
        </button>

        <SectionHeader
          title="Delete Requests"
          description={
            canDecide
              ? "Deletions admins have asked for. Approving carries the deletion out there and then."
              : "Deletions you have asked a super admin to approve."
          }
        >
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </SectionHeader>

        {canDecide && pending > 0 && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg border border-amber-800 bg-amber-900/30 text-amber-200 text-sm">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            {pending} {pending === 1 ? "deletion is" : "deletions are"} waiting on you.
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${
                filter === t
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-8 text-center">
            <Trash2 className="w-6 h-6 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              {filter === "pending"
                ? canDecide
                  ? "Nothing waiting on you."
                  : "You have nothing waiting for approval."
                : `No ${filter} requests.`}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
            {rows.map((row) => {
              const count = Array.isArray(row.payload?.ids) ? row.payload!.ids.length : 0;
              return (
                <div key={row.id} className="p-4 bg-gray-900/60">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-400">
                          {NOUNS[row.resource] ?? row.resource}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border capitalize ${
                            STATUS_STYLE[row.status]
                          }`}
                        >
                          {row.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-100 mt-1 break-words">
                        {row.label || row.resource_id || "—"}
                        {count > 0 && (
                          <span className="text-gray-500 text-xs"> · {count} selected</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                        <Clock className="w-3 h-3" />
                        {when(row.created_at)} · asked by{" "}
                        {row.requested_by_email || row.requested_by}
                      </div>
                      {row.reason && (
                        <div className="text-xs text-gray-400 mt-1">Reason: {row.reason}</div>
                      )}
                      {row.status !== "pending" && (
                        <div className="text-[11px] text-gray-500 mt-1">
                          {row.status === "failed" ? "Could not run" : row.status} by{" "}
                          {row.decided_by_email || "—"} · {when(row.decided_at)}
                          {row.outcome ? ` · ${row.outcome}` : ""}
                          {row.decision_note ? ` · “${row.decision_note}”` : ""}
                        </div>
                      )}
                    </div>

                    {canDecide && row.status === "pending" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => decide(row, "approve")}
                          disabled={busyId !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50"
                          title="Approve and delete now"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve &amp; delete
                        </button>
                        <button
                          onClick={() => decide(row, "reject")}
                          disabled={busyId !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
