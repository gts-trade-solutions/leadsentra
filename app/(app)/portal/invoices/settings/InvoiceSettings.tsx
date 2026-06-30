"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

const FIELDS = [
  "seller_company",
  "seller_address",
  "gstin",
  "pan",
  "email",
  "phone",
  "bank_name",
  "bank_account",
  "bank_branch",
  "bank_ifsc",
  "payment_terms",
  "delivery_terms",
  "declaration",
  "signatory_name",
  "invoice_prefix",
] as const;

type Form = Record<(typeof FIELDS)[number], string>;

const empty: Form = FIELDS.reduce((a, k) => ({ ...a, [k]: "" }), {} as Form);

export default function InvoiceSettings() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(empty);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/invoices/settings", { cache: "no-store", credentials: "same-origin" });
        const json = await res.json().catch(() => ({}));
        const s = json?.settings;
        if (s) {
          const next = { ...empty };
          for (const k of FIELDS) next[k] = s[k] ?? "";
          setForm(next);
          setLogoPath(s.logo_path ?? null);
          setSignaturePath(s.signature_path ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set(k: (typeof FIELDS)[number], v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const fd = new FormData();
      for (const k of FIELDS) fd.append(k, form[k] || "");
      if (logoFile) fd.append("logo", logoFile);
      if (signatureFile) fd.append("signature", signatureFile);
      const res = await fetch("/api/invoices/settings", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      if (json?.settings) {
        setLogoPath(json.settings.logo_path ?? null);
        setSignaturePath(json.settings.signature_path ?? null);
        setLogoFile(null);
        setSignatureFile(null);
      }
      toast({ title: "Settings saved" });
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-4xl mx-auto">
        <button
          onClick={() => router.push("/portal/invoices")}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to invoices
        </button>
        <SectionHeader
          title="Invoice Settings"
          description="These details pre-fill and appear on every proforma invoice you generate."
        >
          {null}
        </SectionHeader>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Your company (seller)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Company name</label>
                  <input className={inputCls} value={form.seller_company} onChange={(e) => set("seller_company", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Invoice number prefix</label>
                  <input className={inputCls} value={form.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value)} placeholder="e.g. RIPL/PI  →  RIPL/PI/2026/09" />
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
                  <input type="file" accept="image/*" className="text-sm text-gray-300" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                  {logoPath && <img src={logoPath} alt="logo" className="mt-2 h-12 bg-white rounded p-1" />}
                </div>
                <div>
                  <label className={labelCls}>Signature {signaturePath && <span className="text-emerald-500">· uploaded</span>}</label>
                  <input type="file" accept="image/*" className="text-sm text-gray-300" onChange={(e) => setSignatureFile(e.target.files?.[0] || null)} />
                  {signaturePath && <img src={signaturePath} alt="signature" className="mt-2 h-12 bg-white rounded p-1" />}
                </div>
              </div>
            </section>

            <div className="flex justify-end pb-10">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
