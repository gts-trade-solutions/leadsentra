"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { BILL_TO_EMPTY, missingBillToFields, type BillToAddress, type BillToInput } from "@/lib/billTo";

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

/**
 * Declared at module scope, not inside the modal: a component defined during
 * render is a new type on every keystroke, so React would unmount the input
 * and the field would lose focus after each character typed.
 */
function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  maxLength,
  uppercase,
  list,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  uppercase?: boolean;
  list?: string;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-emerald-400">*</span>}
      </label>
      <input
        className={inputCls}
        value={value}
        list={list}
        maxLength={maxLength}
        onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/**
 * Add / edit a saved bill-to address.
 *
 * One component behind both entry points — "Quick Add" on the invoice form and
 * Add/Edit on the Manage page — so the two can never drift into asking for
 * different fields for the same record.
 */
export default function BillToAddressModal({
  initial,
  categories = [],
  onClose,
  onSaved,
}: {
  /** The address being edited; omit (or null) to add a new one. */
  initial?: BillToAddress | null;
  /** Categories already in use, offered as suggestions. */
  categories?: string[];
  onClose: () => void;
  onSaved: (address: BillToAddress) => void;
}) {
  const editing = !!initial?.id;
  const [form, setForm] = useState<BillToInput>(() => {
    // A new address starts from the defaults (country = India); an existing one
    // is shown exactly as stored, so a blank field stays blank rather than
    // being quietly re-defaulted on save.
    if (!initial) return { ...BILL_TO_EMPTY };
    const next = { ...BILL_TO_EMPTY };
    for (const key of Object.keys(BILL_TO_EMPTY) as (keyof BillToInput)[]) {
      next[key] = ((initial as any)[key] ?? "") as string;
    }
    return next;
  });
  const [saving, setSaving] = useState(false);

  const missing = useMemo(() => missingBillToFields(form), [form]);
  const set = (patch: Partial<BillToInput>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (missing.length) {
      toast({
        title: "Check the form",
        description: `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/invoices/bill-to/${initial!.id}` : "/api/invoices/bill-to", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save the address");
      toast({
        title: editing ? "Address updated" : "Address saved",
        description: `${json.address?.label || form.label} is ready to reuse on any invoice.`,
      });
      onSaved(json.address as BillToAddress);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-sm font-semibold text-white">
            {editing ? "Edit bill-to address" : "Add new bill-to address"}
          </h2>
          <button
            onClick={() => !saving && onClose()}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Saved once and reused on every invoice. {editing ? "Changes apply to future invoices only — invoices already issued keep the details they were sent with." : "It is selected on this invoice as soon as it is saved."}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label="Label"
            value={form.label || ""}
            onChange={(v) => set({ label: v })}
            placeholder="Clinic / Head office / Dealer name"
            required
            maxLength={255}
          />
          <TextField
            label="Name"
            value={form.name || ""}
            onChange={(v) => set({ name: v })}
            placeholder="Customer / contact name"
            maxLength={255}
          />
          <TextField
            label="Company"
            value={form.company || ""}
            onChange={(v) => set({ company: v })}
            placeholder="Acme Pvt Ltd"
            maxLength={255}
          />
          <div>
            <TextField
              label="Customer category"
              value={form.category || ""}
              onChange={(v) => set({ category: v })}
              placeholder="Clinic, Dealer, Distributor…"
              maxLength={64}
              list="bill-to-categories"
            />
            <datalist id="bill-to-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <TextField
            label="Phone"
            value={form.phone || ""}
            onChange={(v) => set({ phone: v })}
            placeholder="98765 43210 (or two, comma separated)"
            maxLength={64}
          />
          <TextField
            label="Email"
            value={form.email || ""}
            onChange={(v) => set({ email: v })}
            placeholder="buyer@acme.com"
            maxLength={255}
          />
          <TextField
            label="GSTIN"
            value={form.gstin || ""}
            onChange={(v) => set({ gstin: v })}
            placeholder="29ABCDE1234F1Z5"
            maxLength={32}
            uppercase
          />
          <TextField
            label="PAN"
            value={form.pan || ""}
            onChange={(v) => set({ pan: v })}
            placeholder="ABCDE1234F"
            maxLength={10}
            uppercase
          />
          <TextField
            label="Country"
            value={form.country || ""}
            onChange={(v) => set({ country: v })}
            placeholder="India"
            maxLength={64}
          />
          <TextField
            label="City"
            value={form.city || ""}
            onChange={(v) => set({ city: v })}
            placeholder="Chennai"
            required
            maxLength={128}
          />
          <TextField
            label="State"
            value={form.state || ""}
            onChange={(v) => set({ state: v })}
            placeholder="Tamil Nadu"
            required
            maxLength={128}
          />
          <TextField
            label="Pincode"
            value={form.pincode || ""}
            onChange={(v) => set({ pincode: v })}
            placeholder="600032"
            maxLength={16}
          />
          <div className="md:col-span-2">
            <label className={labelCls}>
              Address line 1 <span className="text-emerald-400">*</span>
            </label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.address_line1 || ""}
              onChange={(e) => set({ address_line1: e.target.value })}
              placeholder="Street / building / area"
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Address line 2</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.address_line2 || ""}
              onChange={(e) => set({ address_line2: e.target.value })}
              placeholder="Landmark / additional details"
            />
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          The address prints on the invoice as: line 1, line 2, then “City, State - Pincode”, then the country.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Save address"}
          </button>
        </div>
      </div>
    </div>
  );
}
