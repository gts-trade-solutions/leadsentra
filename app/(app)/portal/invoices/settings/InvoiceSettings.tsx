"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Save, Star, Trash2 } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";
import {
  COMPANY_TEXT_FIELDS,
  companyProfileLabel,
  type CompanyProfile,
  type CompanyTextField,
} from "@/lib/companyProfiles";

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

type Form = Record<CompanyTextField, string>;

const empty: Form = COMPANY_TEXT_FIELDS.reduce((a, k) => ({ ...a, [k]: "" }), {} as Form);

function toForm(c: CompanyProfile | null): Form {
  const next = { ...empty };
  if (!c) return next;
  for (const k of COMPANY_TEXT_FIELDS) next[k] = (c as any)[k] ?? "";
  return next;
}

/**
 * The companies a user invoices as.
 *
 * This was a single "invoice settings" record. It is now one row per company —
 * the picker at the top switches between them — so a second entity can be set
 * up once and chosen on an invoice, instead of these fields being overwritten
 * every time the company changes.
 */
export default function InvoiceSettings() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  /** The company being edited; null while adding a new one. */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const showCompany = useCallback((c: CompanyProfile | null) => {
    setCurrentId(c?.id ?? null);
    setForm(toForm(c));
    setLogoPath(c?.logo_path ?? null);
    setSignaturePath(c?.signature_path ?? null);
    setLogoFile(null);
    setSignatureFile(null);
    setDirty(false);
  }, []);

  const load = useCallback(
    async (selectId?: string) => {
      try {
        const res = await fetch("/api/invoices/companies", { cache: "no-store", credentials: "same-origin" });
        const json = await res.json().catch(() => ({}));
        const list: CompanyProfile[] = Array.isArray(json?.data) ? json.data : [];
        setCompanies(list);
        showCompany(list.find((c) => c.id === selectId) || list[0] || null);
      } finally {
        setLoading(false);
      }
    },
    [showCompany]
  );

  useEffect(() => {
    load();
  }, [load]);

  function set(k: CompanyTextField, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  }

  /** Switching away from unsaved edits would lose them without a word. */
  function switchTo(c: CompanyProfile | null) {
    if (dirty && !confirm("Discard the unsaved changes to this company?")) return;
    showCompany(c);
  }

  async function save() {
    if (!String(form.label || form.seller_company || "").trim()) {
      toast({
        title: "Name the company",
        description: "Give it a name (or a company name) so it can be picked on an invoice.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      for (const k of COMPANY_TEXT_FIELDS) fd.append(k, form[k] || "");
      if (logoFile) fd.append("logo", logoFile);
      if (signatureFile) fd.append("signature", signatureFile);

      const res = await fetch(
        currentId ? `/api/invoices/companies/${currentId}` : "/api/invoices/companies",
        { method: currentId ? "PATCH" : "POST", credentials: "same-origin", body: fd }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      toast({ title: currentId ? "Company saved" : "Company added" });
      await load(json?.company?.id || currentId || undefined);
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault() {
    if (!currentId) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("is_default", "1");
      const res = await fetch(`/api/invoices/companies/${currentId}`, {
        method: "PATCH",
        credentials: "same-origin",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not set the default");
      toast({
        title: "Default company set",
        description: "New invoices start with this one, and offers use it.",
      });
      await load(currentId);
    } catch (e: any) {
      toast({ title: "Could not set the default", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!currentId) return;
    const name = companyProfileLabel(companies.find((c) => c.id === currentId));
    if (!confirm(`Delete "${name}"? Invoices already issued keep the details they were sent with.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/companies/${currentId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Delete failed");
      toast({ title: "Company deleted" });
      setDirty(false);
      await load();
    } catch (e: any) {
      toast({ title: "Could not delete", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const current = companies.find((c) => c.id === currentId) || null;

  return (
    <AuthGuard>
      <div className="p-6 max-w-4xl mx-auto">
        <button
          onClick={() => router.push("/portal/invoices")}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to proforma invoices
        </button>
        <SectionHeader
          title="Companies & invoice settings"
          description="Set a company up once — details, bank, logo, signature — and pick it when you raise an invoice."
        >
          <button
            onClick={() => switchTo(null)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add company
          </button>
        </SectionHeader>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-[16rem] flex-1">
                  <label className={labelCls}>Editing</label>
                  <select
                    className={inputCls}
                    value={currentId ?? ""}
                    onChange={(e) =>
                      switchTo(companies.find((c) => c.id === e.target.value) || null)
                    }
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {companyProfileLabel(c)}
                        {c.is_default ? " (default)" : ""}
                      </option>
                    ))}
                    <option value="">+ New company</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  {current && !current.is_default && (
                    <button
                      onClick={makeDefault}
                      disabled={saving}
                      title="Use this company unless an invoice picks another"
                      className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm disabled:opacity-50"
                    >
                      <Star className="w-4 h-4" /> Make default
                    </button>
                  )}
                  {current && (
                    <button
                      onClick={remove}
                      disabled={saving}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-red-400 rounded-lg text-sm disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                {current?.is_default
                  ? "This is your default company: new invoices start with it, and offers use it."
                  : currentId
                  ? "Pick this company on an invoice to issue under it."
                  : "New company — fill it in and save."}
              </p>
            </section>

            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Your company (seller)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Name in the picker</label>
                  <input
                    className={inputCls}
                    value={form.label}
                    onChange={(e) => set("label", e.target.value)}
                    placeholder="Short name, e.g. GTS Trade"
                  />
                </div>
                <div>
                  <label className={labelCls}>Company name</label>
                  <input className={inputCls} value={form.seller_company} onChange={(e) => set("seller_company", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Proforma Invoice number prefix</label>
                  <input className={inputCls} value={form.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value)} placeholder="e.g. RIPL/PI  →  RIPL/PI/2026/09" />
                  <p className="text-xs text-gray-500 mt-1">Each prefix keeps its own numbering, so two companies never share a series.</p>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Communication address</label>
                  <textarea className={inputCls} rows={2} value={form.seller_address} onChange={(e) => set("seller_address", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>GSTIN</label>
                  <input className={inputCls} value={form.gstin} onChange={(e) => set("gstin", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>PAN</label>
                  <input className={inputCls} value={form.pan} onChange={(e) => set("pan", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Bank details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Bank name</label>
                  <input className={inputCls} value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Account number</label>
                  <input className={inputCls} value={form.bank_account} onChange={(e) => set("bank_account", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Branch</label>
                  <input className={inputCls} value={form.bank_branch} onChange={(e) => set("bank_branch", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>IFSC code</label>
                  <input className={inputCls} value={form.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value)} />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Defaults &amp; signatory</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Default payment terms</label>
                  <input className={inputCls} value={form.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} placeholder="60% advance, 20% loading, 20% before unloading" />
                </div>
                <div>
                  <label className={labelCls}>Default delivery terms</label>
                  <input className={inputCls} value={form.delivery_terms} onChange={(e) => set("delivery_terms", e.target.value)} placeholder="In PDF format with our logo" />
                </div>
                <div>
                  <label className={labelCls}>Authorised signatory name</label>
                  <input className={inputCls} value={form.signatory_name} onChange={(e) => set("signatory_name", e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Declaration</label>
                  <textarea className={inputCls} rows={3} value={form.declaration} onChange={(e) => set("declaration", e.target.value)} placeholder="Certified that the particulars given above are true…" />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Logo &amp; signature (images)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Logo {logoPath && <span className="text-emerald-500">· uploaded</span>}</label>
                  <input type="file" accept="image/*" className="text-sm text-gray-300" onChange={(e) => { setLogoFile(e.target.files?.[0] || null); setDirty(true); }} />
                  {logoPath && <img src={logoPath} alt="logo" className="mt-2 h-12 bg-white rounded p-1" />}
                </div>
                <div>
                  <label className={labelCls}>Signature {signaturePath && <span className="text-emerald-500">· uploaded</span>}</label>
                  <input type="file" accept="image/*" className="text-sm text-gray-300" onChange={(e) => { setSignatureFile(e.target.files?.[0] || null); setDirty(true); }} />
                  {signaturePath && <img src={signaturePath} alt="signature" className="mt-2 h-12 bg-white rounded p-1" />}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Each company carries its own logo and signature — they print on the invoices issued under it.
              </p>
            </section>

            <div className="flex justify-end pb-10">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? "Saving…" : currentId ? "Save company" : "Add company"}
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
