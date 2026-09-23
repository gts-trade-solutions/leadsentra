"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { COMPANY_TEXT_FIELDS, type CompanyProfile, type CompanyTextField } from "@/lib/companyProfiles";

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

type Form = Record<CompanyTextField, string>;
const EMPTY: Form = COMPANY_TEXT_FIELDS.reduce((a, k) => ({ ...a, [k]: "" }), {} as Form);

/**
 * Declared at module scope, not inside the modal: a component defined during
 * render is a new type on every keystroke, so React would unmount the input
 * and the field would lose focus after each character typed.
 */
function Field({
  label,
  value,
  onChange,
  placeholder,
  uppercase,
  wide,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  uppercase?: boolean;
  wide?: boolean;
  multiline?: boolean;
}) {
  const change = (v: string) => onChange(uppercase ? v.toUpperCase() : v);
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <label className={labelCls}>{label}</label>
      {multiline ? (
        <textarea className={inputCls} rows={3} value={value} placeholder={placeholder} onChange={(e) => change(e.target.value)} />
      ) : (
        <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => change(e.target.value)} />
      )}
    </div>
  );
}

/**
 * Add one of your companies without leaving the invoice being written. Posts
 * to the same endpoint as Invoice Settings, so the company is saved in full —
 * details, bank, prefix, logo, signature, seal — and the caller switches the
 * invoice to it.
 */
export default function AddCompanyModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (company: CompanyProfile) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [files, setFiles] = useState<{ logo: File | null; signature: File | null; seal: File | null }>({
    logo: null,
    signature: null,
    seal: null,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: CompanyTextField) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.seller_company.trim() && !form.label.trim()) {
      toast({ title: "Name the company", description: "Enter the company name.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      for (const k of COMPANY_TEXT_FIELDS) fd.append(k, form[k] || "");
      // The picker needs a name; the company name stands in when no short name is given.
      if (!form.label.trim()) fd.set("label", form.seller_company.trim());
      if (files.logo) fd.append("logo", files.logo);
      if (files.signature) fd.append("signature", files.signature);
      if (files.seal) fd.append("seal", files.seal);
      const res = await fetch("/api/invoices/companies", { method: "POST", credentials: "same-origin", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not add the company");
      toast({ title: "Company added", description: `${json.company?.seller_company || json.company?.label} is ready to invoice as.` });
      onSaved(json.company as CompanyProfile);
    } catch (e: any) {
      toast({ title: "Could not add the company", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !saving && onClose()}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Add a company</h2>
          <button onClick={() => !saving && onClose()} className="p-1 rounded hover:bg-gray-800 text-gray-400" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Company name" value={form.seller_company} onChange={set("seller_company")} placeholder="RACE INNOVATIONS PVT LTD" />
          <Field label="Short name (shown in the picker)" value={form.label} onChange={set("label")} placeholder="Optional, e.g. Race Innovations" />
          <Field label="Communication address" value={form.seller_address} onChange={set("seller_address")} multiline wide />
          <Field label="GSTIN" value={form.gstin} onChange={set("gstin")} uppercase />
          <Field label="PAN" value={form.pan} onChange={set("pan")} uppercase />
          <Field label="Email" value={form.email} onChange={set("email")} />
          <Field label="Phone" value={form.phone} onChange={set("phone")} />
          <Field label="Invoice number prefix" value={form.invoice_prefix} onChange={set("invoice_prefix")} placeholder="e.g. RIPL/PI → RIPL/PI/2026/01" />
          <Field label="Authorised signatory name" value={form.signatory_name} onChange={set("signatory_name")} />
          <Field label="Bank name" value={form.bank_name} onChange={set("bank_name")} />
          <Field label="Account number" value={form.bank_account} onChange={set("bank_account")} />
          <Field label="Branch" value={form.bank_branch} onChange={set("bank_branch")} />
          <Field label="IFSC code" value={form.bank_ifsc} onChange={set("bank_ifsc")} uppercase />
          {(["logo", "signature", "seal"] as const).map((kind) => (
            <div key={kind}>
              <label className={labelCls}>{kind === "logo" ? "Logo" : kind === "signature" ? "Signature" : "Company seal"}</label>
              <input
                type="file"
                accept="image/*"
                className="text-sm text-gray-300"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFiles((prev) => ({ ...prev, [kind]: f }));
                }}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Payment/delivery terms and the declaration can be set later under Invoice Settings.
        </p>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add company"}
          </button>
        </div>
      </div>
    </div>
  );
}
