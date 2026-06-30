"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Download, Trash2, Eye, Settings, ArrowLeft, LayoutTemplate, ReceiptText, Send } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import EmptyState from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/invoices";

type OfferRow = {
  id: string;
  offer_number: string;
  status: string;
  customer_name: string | null;
  customer_company: string | null;
  customer_email: string | null;
  currency: string;
  total: string | number;
  issue_date: string;
  sent_at: string | null;
  created_at: string;
};

export default function OffersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/offers", { cache: "no-store", credentials: "same-origin" });
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

  async function sendOffer(row: OfferRow) {
    const to = row.customer_email;
    if (!to) {
      toast({
        title: "No recipient email",
        description: "Open the offer and add the recipient's email before sending.",
        variant: "destructive",
      });
      return;
    }
    if (!confirm(`Send offer ${row.offer_number} to ${to}? A Proforma Invoice will be generated automatically.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/offers/${row.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");
      if (json.invoice_number) {
        toast({
          title: "Offer sent",
          description: `Emailed to ${json.to}. Proforma Invoice ${json.invoice_number} ${json.invoiceCreated ? "generated" : "already existed"}.`,
        });
      } else {
        toast({
          title: "Offer sent",
          description: json.invoiceError || `Emailed to ${json.to}.`,
          variant: json.invoiceError ? "destructive" : undefined,
        });
      }
      load();
    } catch (e: any) {
      toast({ title: "Could not send", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function generateInvoice(row: OfferRow) {
    if (!confirm(`Generate a Proforma Invoice from offer ${row.offer_number}?`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/offers/${row.id}/invoice`, { method: "POST", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not generate invoice");
      toast({
        title: "Proforma Invoice created",
        description: `${json.invoice_number} — opening your invoices…`,
      });
      router.push("/portal/invoices");
    } catch (e: any) {
      toast({ title: "Could not generate invoice", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: OfferRow) {
    if (!confirm(`Delete offer ${row.offer_number}? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/offers/${row.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Delete failed");
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({ title: "Offer deleted" });
    } catch (e: any) {
      toast({ title: "Could not delete", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-7xl mx-auto">
        <button
          onClick={() => router.push("/portal/catalogues")}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Catalogues & Offers
        </button>
        <SectionHeader
          title="LBI Route-Survey Offers"
          description="Create and download RACE INTELLECT (Location Based Intelligence) route-survey offers."
        >
          <button
            onClick={() => router.push("/portal/offers/templates")}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
            title="Create / edit offer templates"
          >
            <LayoutTemplate className="w-4 h-4" /> Templates
          </button>
          <button
            onClick={() => router.push("/portal/invoices/settings")}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
            title="Seller / bank / logo settings"
          >
            <Settings className="w-4 h-4" /> Settings
          </button>
          <button
            onClick={() => router.push("/portal/offers/new")}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Offer
          </button>
        </SectionHeader>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No offers yet"
            description="Create your first LBI route-survey offer — fill the dynamic fields and the rest of the template is filled in for you."
            primary={{ label: "New Offer", onClick: () => router.push("/portal/offers/new") }}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-4 py-3 font-medium">Quote #</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium text-white tabular-nums">{r.offer_number}</td>
                    <td className="px-4 py-3 text-gray-200">
                      <div>{r.customer_company || r.customer_name || "—"}</div>
                      {r.customer_name && r.customer_company && (
                        <div className="text-xs text-gray-500">{r.customer_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-200 tabular-nums">
                      {formatMoney(Number(r.total), r.currency)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.issue_date}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === "sent" ? "bg-emerald-600/20 text-emerald-400" : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <a
                          href={`/api/offers/${r.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          title="Preview PDF"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300"
                        >
                          <Eye className="w-4 h-4" />
                        </a>
                        <a
                          href={`/api/offers/${r.id}/pdf?download=1`}
                          title="Download PDF"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => sendOffer(r)}
                          disabled={busyId === r.id}
                          title="Send offer by email (auto-generates the Proforma Invoice)"
                          className="p-2 rounded-lg hover:bg-gray-700 text-emerald-400 disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => generateInvoice(r)}
                          disabled={busyId === r.id}
                          title="Generate Proforma Invoice only (without sending)"
                          className="p-2 rounded-lg hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                        >
                          <ReceiptText className="w-4 h-4" />
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
