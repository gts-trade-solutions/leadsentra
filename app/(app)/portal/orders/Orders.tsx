"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Trash2, RefreshCcw, FileText } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import EmptyState from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/invoices";

type Order = {
  id: string;
  order_number: string;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_name: string | null;
  customer_company: string | null;
  customer_email: string | null;
  currency: string;
  total: number;
  status: string;
  po_number: string | null;
  confirmed_at: string;
};

const STATUSES = ["confirmed", "in_progress", "delivered", "cancelled"];

export default function OrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orders", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      setRows(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(row: Order, status: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/orders/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Update failed");
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
    } catch (e: any) {
      toast({ title: "Could not update", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: Order) {
    if (!confirm(`Delete order ${row.order_number}? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/orders/${row.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Delete failed");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({ title: "Order deleted" });
    } catch (e: any) {
      toast({ title: "Could not delete", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-7xl mx-auto">
        <SectionHeader title="Orders" description="Confirmed orders. Mark a proforma invoice as an order confirmation to add it here.">
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
            <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </SectionHeader>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No orders yet"
            description="When a customer confirms, open Proforma Invoices and use “Mark as order confirmation”."
            primary={{ label: "Go to Proforma Invoices", onClick: () => router.push("/portal/invoices") }}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-4 py-3 font-medium">Order #</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">From PI</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium">Confirmed</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium text-white tabular-nums">{r.order_number}</td>
                    <td className="px-4 py-3 text-gray-200">
                      <div>{r.customer_company || r.customer_name || "—"}</div>
                      {r.customer_email && <div className="text-xs text-gray-500">{r.customer_email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {r.invoice_id ? (
                        <a href={`/api/invoices/${r.invoice_id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
                          <FileText className="w-3.5 h-3.5" />{r.invoice_number || "PI"}
                        </a>
                      ) : (
                        r.invoice_number || "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200 tabular-nums">{formatMoney(Number(r.total), r.currency)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmt(r.confirmed_at)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={r.status}
                        disabled={busyId === r.id}
                        onChange={(e) => setStatus(r, e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 capitalize"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s.replace("_", " ")}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <button onClick={() => remove(r)} disabled={busyId === r.id} title="Delete" className="p-2 rounded-lg hover:bg-gray-700 text-red-400 disabled:opacity-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
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

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
