"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Send, Download, Trash2, Eye, Settings, Upload, ClipboardCheck } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import EmptyState from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/invoices";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  customer_name: string | null;
  customer_company: string | null;
  customer_email: string | null;
  currency: string;
  total: string | number;
  issue_date: string;
  valid_until: string | null;
  sent_at: string | null;
  created_at: string;
  source?: string;
};

export default function InvoicesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices", { cache: "no-store", credentials: "same-origin" });
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

  async function sendInvoice(row: InvoiceRow) {
    if (!row.customer_email) {
      toast({
        title: "No customer email",
        description: "Open the invoice and add a customer email before sending.",
        variant: "destructive",
      });
      return;
    }
    if (!confirm(`Send invoice ${row.invoice_number} to ${row.customer_email}?`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/invoices/${row.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");
      toast({ title: "Invoice sent", description: `Emailed to ${json.to}` });
      load();
    } catch (e: any) {
      toast({ title: "Could not send", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function markAsOrder(row: InvoiceRow) {
    if (!confirm(`Mark invoice ${row.invoice_number} as an order confirmation? It will be added to Orders.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/invoices/${row.id}/order`, { method: "POST", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not create order");
      toast({
        title: json.existed ? "Already an order" : "Order confirmed",
        description: `${json.order_number} ${json.existed ? "already exists" : "created"} — opening Orders…`,
      });
      router.push("/portal/orders");
    } catch (e: any) {
      toast({ title: "Could not confirm order", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: InvoiceRow) {
    if (!confirm(`Delete invoice ${row.invoice_number}? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/invoices/${row.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Delete failed");
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({ title: "Invoice deleted" });
    } catch (e: any) {
      toast({ title: "Could not delete", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-7xl mx-auto">
        <SectionHeader
          title="Proforma Invoices"
          description="Create, preview, and email proforma invoices to your customers."
        >
          <button
            onClick={() => router.push("/portal/invoices/settings")}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
            title="Invoice settings"
          >
            <Settings className="w-4 h-4" /> Settings
          </button>
          <button
            onClick={() => router.push("/portal/invoices/new?mode=upload")}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" /> Upload PDF
          </button>
          <button
            onClick={() => router.push("/portal/invoices/new")}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Invoice
          </button>
        </SectionHeader>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Create your first proforma invoice and email it to a customer with a PDF attached."
            primary={{
              label: "New Invoice",
              onClick: () => router.push("/portal/invoices/new"),
            }}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-4 py-3 font-medium">Invoice #</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium text-white tabular-nums">
                      {r.invoice_number}
                      {r.source === "upload" && (
                        <span className="ml-2 align-middle inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-600/20 text-blue-400">
                          uploaded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-200">
                      <div>{r.customer_company || r.customer_name || "—"}</div>
                      {r.customer_email && (
                        <div className="text-xs text-gray-500">{r.customer_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200 tabular-nums">
                      {formatMoney(Number(r.total), r.currency)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.issue_date}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === "sent"
                            ? "bg-emerald-600/20 text-emerald-400"
                            : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <a
                          href={`/api/invoices/${r.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          title="Preview PDF"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300"
                        >
                          <Eye className="w-4 h-4" />
                        </a>
                        <a
                          href={`/api/invoices/${r.id}/pdf?download=1`}
                          title="Download PDF"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => sendInvoice(r)}
                          disabled={busyId === r.id}
                          title="Send to customer"
                          className="p-2 rounded-lg hover:bg-gray-700 text-emerald-400 disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => markAsOrder(r)}
                          disabled={busyId === r.id}
                          title="Mark as order confirmation"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                        >
                          <ClipboardCheck className="w-4 h-4" />
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
      </div>
    </AuthGuard>
  );
}
