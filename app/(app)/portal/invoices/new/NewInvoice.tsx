"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { ArrowLeft, Plus, Trash2, Save, Send, Upload, FileSpreadsheet, FileText, Eye } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";
import { computeTotals, normalizeItems, formatMoney, num } from "@/lib/invoices";

type ContactOpt = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  company_id: string | null;
};

type ItemRow = { part_no: string; description: string; hsn: string; quantity: string; unit_price: string };

const blankItem = (): ItemRow => ({ part_no: "", description: "", hsn: "", quantity: "1", unit_price: "0" });
const todayStr = () => new Date().toISOString().slice(0, 10);

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

const emptyCustomer = {
  contact_id: "",
  company_id: "",
  name: "",
  email: "",
  company: "",
  gstin: "",
  address: "",
};

export default function NewInvoice() {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "upload">("manual");

  const [contacts, setContacts] = useState<ContactOpt[]>([]);
  const [selectedContact, setSelectedContact] = useState<string>("");
  const [contactQuery, setContactQuery] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [customer, setCustomer] = useState({ ...emptyCustomer });

  // Manual-only state
  const [currency, setCurrency] = useState("INR");
  const [issueDate, setIssueDate] = useState(todayStr());
  const [validUntil, setValidUntil] = useState("");
  const [discount, setDiscount] = useState("0");
  const [taxRate, setTaxRate] = useState("18");
  const [ref, setRef] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<ItemRow[]>([blankItem()]);

  // Upload-only state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadTotal, setUploadTotal] = useState("");

  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Default the tab from ?mode=upload (read client-side to avoid prerender bail).
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    if (/(\?|&)mode=upload/.test(qs)) setMode("upload");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/contacts?limit=2000", { cache: "no-store", credentials: "same-origin" });
        const json = await res.json().catch(() => ({}));
        const list: ContactOpt[] = (Array.isArray(json?.data) ? json.data : []).map((c: any) => ({
          id: c.id,
          name: c.name ?? null,
          email: c.email ?? null,
          company: c.company ?? null,
          company_id: c.company_id ?? null,
        }));
        setContacts(list);
      } catch {
        setContacts([]);
      }
    })();
  }, []);

  const contactLabel = useCallback(
    (c: ContactOpt) => [c.name, c.company, c.email].filter(Boolean).join(" · ") || c.id,
    []
  );

  const onPickContact = useCallback(
    (c: ContactOpt) => {
      setSelectedContact(c.id);
      setContactQuery(contactLabel(c));
      setContactOpen(false);
      setCustomer({
        contact_id: c.id,
        company_id: c.company_id || "",
        name: c.name || "",
        email: c.email || "",
        company: c.company || "",
        gstin: "",
        address: "",
      });
    },
    [contactLabel]
  );

  function clearContact() {
    setSelectedContact("");
    setContactQuery("");
    setContactOpen(false);
    setCustomer((c) => ({ ...c, contact_id: "", company_id: "" }));
  }

  // Filter contacts by the typed query (name / company / email), cap results.
  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const base = !q
      ? contacts
      : contacts.filter((c) =>
          [c.name, c.company, c.email].some((f) => (f || "").toLowerCase().includes(q))
        );
    return base.slice(0, 50);
  }, [contacts, contactQuery]);

  const totals = useMemo(() => {
    const normalized = normalizeItems(
      items.map((it) => ({
        description: it.description,
        part_no: it.part_no,
        hsn: it.hsn,
        quantity: num(it.quantity, 0),
        unit_price: num(it.unit_price, 0),
      }))
    );
    return { ...computeTotals(normalized, num(discount, 0), num(taxRate, 0)), count: normalized.length };
  }, [items, discount, taxRate]);

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  // ---- Spreadsheet import (client-side, CSV or Excel) ----
  function pick(obj: Record<string, any>, keys: string[]): string {
    const lower: Record<string, any> = {};
    for (const k of Object.keys(obj)) lower[k.toLowerCase().trim()] = obj[k];
    for (const key of keys) {
      const v = lower[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  }

  async function onImportFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      const mapped: ItemRow[] = rows
        .map((r) => ({
          description: pick(r, ["description", "desc", "particulars", "item", "details"]),
          part_no: pick(r, ["part_no", "part no", "part", "partno", "sku", "code"]),
          hsn: pick(r, ["hsn", "hsn/sac", "sac", "hsn code"]),
          quantity: pick(r, ["quantity", "qty", "nos", "units"]) || "1",
          unit_price: pick(r, ["unit_price", "unit price", "rate", "price", "amount", "rate inr"]) || "0",
        }))
        .filter((r) => r.description);
      if (!mapped.length) {
        toast({
          title: "No rows found",
          description: "Expected columns like Description, Part No, Qty, Rate.",
          variant: "destructive",
        });
        return;
      }
      setItems(mapped);
      toast({ title: "Imported", description: `${mapped.length} line item(s) loaded.` });
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message || String(e), variant: "destructive" });
    }
  }

  function buildManualPayload() {
    return {
      customer_contact_id: customer.contact_id || null,
      customer_company_id: customer.company_id || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_company: customer.company || null,
      customer_gstin: customer.gstin || null,
      customer_address: customer.address || null,
      currency,
      issue_date: issueDate,
      valid_until: validUntil || null,
      discount: num(discount, 0),
      tax_rate: num(taxRate, 0),
      ref: ref || null,
      payment_terms: paymentTerms || null,
      delivery_terms: deliveryTerms || null,
      notes: notes || null,
      terms: terms || null,
      items: items.map((it) => ({
        part_no: it.part_no || null,
        description: it.description,
        hsn: it.hsn || null,
        quantity: num(it.quantity, 0),
        unit_price: num(it.unit_price, 0),
      })),
    };
  }

  async function createInvoice(): Promise<{ id: string; invoice_number: string } | null> {
    if (mode === "manual") {
      if (!customer.name && !customer.company) {
        toast({ title: "Check the form", description: "Enter a customer name or company.", variant: "destructive" });
        return null;
      }
      if (!items.some((it) => it.description.trim())) {
        toast({ title: "Check the form", description: "Add at least one line item.", variant: "destructive" });
        return null;
      }
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(buildManualPayload()),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save invoice");
      return json;
    }
    // upload mode
    if (!pdfFile) {
      toast({ title: "Attach a PDF", description: "Choose the proforma PDF to upload.", variant: "destructive" });
      return null;
    }
    if (!customer.name && !customer.company) {
      toast({ title: "Check the form", description: "Enter a customer name or company.", variant: "destructive" });
      return null;
    }
    const fd = new FormData();
    fd.append("file", pdfFile);
    fd.append("customer_contact_id", customer.contact_id || "");
    fd.append("customer_company_id", customer.company_id || "");
    fd.append("customer_name", customer.name || "");
    fd.append("customer_email", customer.email || "");
    fd.append("customer_company", customer.company || "");
    fd.append("customer_gstin", customer.gstin || "");
    fd.append("customer_address", customer.address || "");
    fd.append("currency", currency);
    fd.append("issue_date", issueDate);
    fd.append("total", String(num(uploadTotal, 0)));
    fd.append("notes", notes || "");
    const res = await fetch("/api/invoices/upload", { method: "POST", credentials: "same-origin", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Could not upload invoice");
    return json;
  }

  async function preview() {
    // Upload mode: just open the chosen PDF locally — nothing to render.
    if (mode === "upload") {
      if (!pdfFile) {
        toast({ title: "Choose a PDF first", description: "Select the proforma PDF to preview.", variant: "destructive" });
        return;
      }
      window.open(URL.createObjectURL(pdfFile), "_blank");
      return;
    }
    if (!items.some((it) => it.description.trim())) {
      toast({ title: "Nothing to preview", description: "Add at least one line item.", variant: "destructive" });
      return;
    }
    // Open the tab synchronously (before the await) so popup blockers allow it.
    const win = window.open("", "_blank");
    setPreviewing(true);
    try {
      const res = await fetch("/api/invoices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(buildManualPayload()),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Preview failed");
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.open(url, "_blank");
    } catch (e: any) {
      if (win) win.close();
      toast({ title: "Preview failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  async function save(thenSend: boolean) {
    if (thenSend && !customer.email) {
      toast({
        title: "Customer email required",
        description: "Add the customer's email to send the invoice.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const created = await createInvoice();
      if (!created) return;

      if (!thenSend) {
        toast({ title: "Draft saved", description: `Invoice ${created.invoice_number} created.` });
        router.push("/portal/invoices");
        return;
      }
      const sendRes = await fetch(`/api/invoices/${created.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ to: customer.email, message: message || undefined }),
      });
      const sendJson = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        toast({
          title: "Saved, but not sent",
          description: sendJson?.error || "Email send failed. You can retry from the list.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Invoice sent", description: `Emailed to ${sendJson.to}` });
      }
      router.push("/portal/invoices");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const TabButton = ({ value, icon: Icon, label }: { value: "manual" | "upload"; icon: any; label: string }) => (
    <button
      onClick={() => setMode(value)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${
        mode === value
          ? "bg-emerald-600 border-emerald-600 text-white"
          : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  // Shared customer block (both modes).
  const CustomerCard = (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
      <h2 className="text-sm font-semibold text-white mb-4">Customer</h2>
      <div className="mb-4 relative">
        <label className={labelCls}>Search contacts</label>
        <input
          className={inputCls}
          value={contactQuery}
          placeholder="Type a name, company, or email…"
          onChange={(e) => {
            setContactQuery(e.target.value);
            setContactOpen(true);
            if (selectedContact) setSelectedContact("");
          }}
          onFocus={() => setContactOpen(true)}
          onBlur={() => setTimeout(() => setContactOpen(false), 150)}
        />
        {contactOpen && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
            {filteredContacts.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">
                {contacts.length === 0 ? "No contacts yet — fill the fields below manually." : "No matching contacts"}
              </div>
            ) : (
              filteredContacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  // preventDefault keeps input focus so onBlur doesn't beat the click
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPickContact(c)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-700"
                >
                  <div className="text-sm text-gray-200 font-medium">{c.name || c.company || "(no name)"}</div>
                  <div className="text-xs text-gray-500">{[c.company, c.email].filter(Boolean).join(" · ")}</div>
                </button>
              ))
            )}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-gray-500">Or just type the customer details below.</span>
          {selectedContact && (
            <button type="button" onClick={clearContact} className="text-xs text-gray-400 hover:text-emerald-400">
              Clear selection
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Customer name</label>
          <input className={inputCls} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Jane Buyer" />
        </div>
        <div>
          <label className={labelCls}>Company</label>
          <input className={inputCls} value={customer.company} onChange={(e) => setCustomer({ ...customer, company: e.target.value })} placeholder="Acme Pvt Ltd" />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input className={inputCls} type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="buyer@acme.com" />
        </div>
        <div>
          <label className={labelCls}>GSTIN (optional)</label>
          <input className={inputCls} value={customer.gstin} onChange={(e) => setCustomer({ ...customer, gstin: e.target.value })} placeholder="29ABCDE1234F1Z5" />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Billing address (optional)</label>
          <textarea className={inputCls} rows={2} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Street, City, State, PIN" />
        </div>
      </div>
    </section>
  );

  return (
    <AuthGuard>
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => router.push("/portal/invoices")} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to invoices
        </button>

        <SectionHeader title="New Proforma Invoice" description="Build one from line items, or upload a ready-made PDF.">
          {null}
        </SectionHeader>

        <div className="flex items-center gap-2 mb-6">
          <TabButton value="manual" icon={FileText} label="Manual (generate PDF)" />
          <TabButton value="upload" icon={Upload} label="Upload PDF" />
          <a
            href="/portal/invoices/settings"
            className="ml-auto text-xs text-gray-400 hover:text-emerald-400 underline"
          >
            Edit seller / bank / logo settings →
          </a>
        </div>

        <div className="space-y-6">
          {CustomerCard}

          {mode === "manual" ? (
            <>
              {/* Line items */}
              <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-white">Line items</h2>
                  <div className="flex items-center gap-2">
                    <input
                      ref={importRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onImportFile(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      onClick={() => importRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm"
                      title="Import from CSV/Excel"
                    >
                      <FileSpreadsheet className="w-4 h-4" /> Import
                    </button>
                    <button onClick={addItem} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm">
                      <Plus className="w-4 h-4" /> Add row
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-gray-500 px-1">
                    <div className="col-span-2">Part No</div>
                    <div className="col-span-4">Description</div>
                    <div className="col-span-1">HSN</div>
                    <div className="col-span-1 text-right">Qty</div>
                    <div className="col-span-2 text-right">Unit price</div>
                    <div className="col-span-1 text-right">Amount</div>
                    <div className="col-span-1" />
                  </div>
                  {items.map((it, idx) => {
                    const amount = num(it.quantity, 0) * num(it.unit_price, 0);
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <input className={`${inputCls} col-span-6 md:col-span-2`} value={it.part_no} onChange={(e) => updateItem(idx, { part_no: e.target.value })} placeholder="Part / SKU" />
                        <input className={`${inputCls} col-span-12 md:col-span-4`} value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Product or service description" />
                        <input className={`${inputCls} col-span-3 md:col-span-1`} value={it.hsn} onChange={(e) => updateItem(idx, { hsn: e.target.value })} placeholder="HSN" />
                        <input className={`${inputCls} col-span-3 md:col-span-1 text-right`} value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} inputMode="decimal" />
                        <input className={`${inputCls} col-span-4 md:col-span-2 text-right`} value={it.unit_price} onChange={(e) => updateItem(idx, { unit_price: e.target.value })} inputMode="decimal" />
                        <div className="col-span-3 md:col-span-1 text-right text-sm text-gray-200 py-2 tabular-nums">{formatMoney(amount, currency)}</div>
                        <div className="col-span-2 md:col-span-1 flex justify-end">
                          <button onClick={() => removeItem(idx)} disabled={items.length === 1} className="p-2 rounded-lg hover:bg-gray-700 text-red-400 disabled:opacity-30" title="Remove row">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Import accepts columns like <span className="text-gray-400">Part No, Description, HSN, Qty, Rate</span>.
                </p>
              </section>

              {/* Details + totals */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white">Details</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Currency</label>
                      <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                        <option value="INR">INR (₹)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Issue date</label>
                      <input type="date" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Valid until (optional)</label>
                      <input type="date" className={inputCls} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Discount ({currency})</label>
                      <input className={inputCls} value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
                    </div>
                    <div>
                      <label className={labelCls}>GST / Tax rate (%)</label>
                      <input className={inputCls} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className={labelCls}>REF (optional)</label>
                      <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="As per mail communication" />
                    </div>
                    <div>
                      <label className={labelCls}>Mode/Terms of Payment (optional, else from settings)</label>
                      <input className={inputCls} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="60% advance, 20% loading, 20% before unloading" />
                    </div>
                    <div>
                      <label className={labelCls}>Delivery (optional, else from settings)</label>
                      <input className={inputCls} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} placeholder="In PDF format with our logo" />
                    </div>
                    <div>
                      <label className={labelCls}>Notes (optional)</label>
                      <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Email message (optional)</label>
                      <textarea className={inputCls} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 h-fit">
                  <h2 className="text-sm font-semibold text-white mb-4">Totals</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-gray-400">
                      <span>Subtotal ({totals.count} item{totals.count === 1 ? "" : "s"})</span>
                      <span className="text-gray-200 tabular-nums">{formatMoney(totals.subtotal, currency)}</span>
                    </div>
                    {totals.discount > 0 && (
                      <div className="flex justify-between text-gray-400">
                        <span>Discount</span>
                        <span className="text-gray-200 tabular-nums">- {formatMoney(totals.discount, currency)}</span>
                      </div>
                    )}
                    {totals.tax_rate > 0 && (
                      <div className="flex justify-between text-gray-400">
                        <span>GST ({totals.tax_rate}%)</span>
                        <span className="text-gray-200 tabular-nums">{formatMoney(totals.tax_amount, currency)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-gray-800 text-base font-semibold">
                      <span className="text-white">Total</span>
                      <span className="text-emerald-400 tabular-nums">{formatMoney(totals.total, currency)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-4">
                    Bank details, PAN, declaration, logo &amp; signature come from your{" "}
                    <a href="/portal/invoices/settings" className="text-emerald-400 underline">invoice settings</a>.
                  </p>
                </div>
              </section>
            </>
          ) : (
            /* Upload mode */
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">Upload proforma PDF</h2>
              <div>
                <label className={labelCls}>PDF file</label>
                <input
                  type="file"
                  accept="application/pdf"
                  className="text-sm text-gray-300"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                />
                {pdfFile && <p className="text-xs text-gray-500 mt-1">{pdfFile.name} ({Math.round(pdfFile.size / 1024)} KB)</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Currency</label>
                  <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Total amount (optional)</label>
                  <input className={inputCls} value={uploadTotal} onChange={(e) => setUploadTotal(e.target.value)} inputMode="decimal" placeholder="236000" />
                </div>
                <div>
                  <label className={labelCls}>Issue date</label>
                  <input type="date" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Email message (optional)</label>
                <textarea className={inputCls} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              <p className="text-xs text-gray-500">
                Your uploaded PDF is attached as-is when sending — no PDF is generated.
              </p>
            </section>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pb-10">
            <button onClick={preview} disabled={previewing || saving} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium disabled:opacity-50">
              <Eye className="w-4 h-4" /> {previewing ? "Rendering…" : "Preview"}
            </button>
            <button onClick={() => save(false)} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium disabled:opacity-50">
              <Save className="w-4 h-4" /> Save draft
            </button>
            <button onClick={() => save(true)} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              <Send className="w-4 h-4" /> {saving ? "Working…" : "Save & Send"}
            </button>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
