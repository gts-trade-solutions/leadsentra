"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookUser, Pencil, Plus, Trash2 } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import EmptyState from "@/components/EmptyState";
import BillToAddressModal from "@/components/BillToAddressModal";
import { toast } from "@/hooks/use-toast";
import { billToMatches, composeBillToAddress, type BillToAddress } from "@/lib/billTo";

/**
 * Saved bill-to addresses — the address book behind the invoice form's
 * prefill. Create each customer once here (or let an invoice capture them),
 * then correct them field by field as things change.
 */
export default function BillToAddresses() {
  const router = useRouter();
  const [rows, setRows] = useState<BillToAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** null = closed, {} = adding, {…row} = editing that row. */
  const [editing, setEditing] = useState<BillToAddress | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices/bill-to", { cache: "no-store", credentials: "same-origin" });
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

  const filtered = useMemo(() => rows.filter((r) => billToMatches(r, query)), [rows, query]);
  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => (r.category || "").trim()).filter(Boolean))).sort(),
    [rows]
  );

  async function remove(row: BillToAddress) {
    if (!confirm(`Delete "${row.label}" from your saved addresses? Invoices already issued are not affected.`)) {
      return;
    }
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/invoices/bill-to/${row.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not delete the address");
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({ title: "Address deleted", description: `${row.label} was removed from the address book.` });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  function onSaved(saved: BillToAddress) {
    setRows((prev) => {
      const without = prev.filter((r) => r.id !== saved.id);
      return [saved, ...without];
    });
    setEditing(undefined);
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-6xl mx-auto">
        <button
          onClick={() => router.push("/portal/invoices/new")}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to invoice
        </button>

        <SectionHeader
          title="Saved Bill-To Addresses"
          description="Create an address once and reuse it on every invoice — pick it by email and the customer block fills itself in."
        >
          <button
            onClick={() => setEditing(null)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add address
          </button>
        </SectionHeader>

        <div className="mb-4">
          <input
            className="w-full max-w-md px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, phone, city, GSTIN…"
          />
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading addresses…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BookUser}
            title="No saved addresses yet"
            description="Add a customer here, or just raise an invoice — whoever it is billed to is saved automatically and offered next time."
            primary={{ label: "Add address", onClick: () => setEditing(null) }}
            secondary={{ label: "New proforma invoice", onClick: () => router.push("/portal/invoices/new") }}
          />
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            No saved address matches “{query}”.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">City / State</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/40 align-top">
                    <td className="px-4 py-3 font-medium text-white">
                      {r.label}
                      {r.category && (
                        <span className="ml-2 align-middle inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-300">
                          {r.category}
                        </span>
                      )}
                      <div className="text-xs text-gray-500 whitespace-pre-line mt-1">
                        {composeBillToAddress(r)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-200">
                      <div>{r.name || "—"}</div>
                      {r.company && <div className="text-xs text-gray-400">{r.company}</div>}
                      {r.gstin && <div className="text-xs text-gray-500">GSTIN {r.gstin}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{r.email || "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{r.phone || "—"}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                      {r.pincode && <div className="text-xs text-gray-500">{r.pincode}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(r)}
                          disabled={busyId === r.id}
                          title="Edit"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(r)}
                          disabled={busyId === r.id}
                          title="Delete"
                          className="p-2 rounded-lg hover:bg-gray-700 text-red-400 disabled:opacity-50"
                        >
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

        {editing !== undefined && (
          <BillToAddressModal
            initial={editing}
            categories={categories}
            onClose={() => setEditing(undefined)}
            onSaved={onSaved}
          />
        )}
      </div>
    </AuthGuard>
  );
}
