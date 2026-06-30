"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Save, Eye } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";
import { num, formatMoney } from "@/lib/invoices";
import { OFFER_DEFAULTS } from "@/lib/offers";

type ContactOpt = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  company_id: string | null;
};

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";
const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyRecipient = { contact_id: "", company_id: "", company: "", name: "", email: "", address: "" };

export default function NewOffer() {
  const router = useRouter();

  // Recipient + contact search
  const [contacts, setContacts] = useState<ContactOpt[]>([]);
  const [selectedContact, setSelectedContact] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [recipient, setRecipient] = useState({ ...emptyRecipient });
  const [salutation, setSalutation] = useState<string>(OFFER_DEFAULTS.salutation);

  // Templates
  const [templates, setTemplates] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [templateId, setTemplateId] = useState("");

  // Offer meta
  const [offerNumber, setOfferNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayStr());
  const [currency, setCurrency] = useState("INR");
  const [validityDays, setValidityDays] = useState(String(OFFER_DEFAULTS.validity_days));
  const [taxRate, setTaxRate] = useState(String(OFFER_DEFAULTS.tax_rate));

  // Routes + subject
  const [routes, setRoutes] = useState<string[]>([""]);
  const [subject, setSubject] = useState("");

  // Cargo dimensions
  const [cargoLength, setCargoLength] = useState("");
  const [cargoWeight, setCargoWeight] = useState("");
  const [cargoDiameter, setCargoDiameter] = useState("");

  // Commercial
  const [surveyTimeline, setSurveyTimeline] = useState<string>(OFFER_DEFAULTS.survey_timeline);
  const [delivery, setDelivery] = useState<string>(OFFER_DEFAULTS.delivery);
  const [total, setTotal] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<string>(OFFER_DEFAULTS.payment_terms);

  // Signatories
  const [letterName, setLetterName] = useState<string>(OFFER_DEFAULTS.letter_signatory_name);
  const [letterTitle, setLetterTitle] = useState<string>(OFFER_DEFAULTS.letter_signatory_title);
  const [offerName, setOfferName] = useState<string>(OFFER_DEFAULTS.offer_signatory_name);
  const [offerTitle, setOfferTitle] = useState<string>(OFFER_DEFAULTS.offer_signatory_title);

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

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

  // Load offer templates (the API seeds the default LBI template on first use).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/offer-templates", { cache: "no-store", credentials: "same-origin" });
        const json = await res.json().catch(() => ({}));
        const list = (Array.isArray(json?.data) ? json.data : []).map((t: any) => ({
          id: t.id,
          name: t.name,
          is_default: !!t.is_default,
        }));
        setTemplates(list);
        const def = list.find((t: any) => t.is_default) || list[0];
        if (def) setTemplateId((cur) => cur || def.id);
      } catch {
        setTemplates([]);
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
      setRecipient({
        contact_id: c.id,
        company_id: c.company_id || "",
        company: c.company || "",
        name: c.name || "",
        email: c.email || "",
        address: "",
      });
    },
    [contactLabel]
  );

  function clearContact() {
    setSelectedContact("");
    setContactQuery("");
    setContactOpen(false);
    setRecipient((r) => ({ ...r, contact_id: "", company_id: "" }));
  }

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const base = !q
      ? contacts
      : contacts.filter((c) => [c.name, c.company, c.email].some((f) => (f || "").toLowerCase().includes(q)));
    return base.slice(0, 50);
  }, [contacts, contactQuery]);

  const updateRoute = (idx: number, val: string) =>
    setRoutes((prev) => prev.map((r, i) => (i === idx ? val : r)));
  const addRoute = () => setRoutes((prev) => [...prev, ""]);
  const removeRoute = (idx: number) =>
    setRoutes((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  function buildPayload() {
    return {
      template_id: templateId || null,
      offer_number: offerNumber || null,
      issue_date: issueDate,
      currency,
      validity_days: num(validityDays, OFFER_DEFAULTS.validity_days),
      tax_rate: num(taxRate, OFFER_DEFAULTS.tax_rate),
      customer_contact_id: recipient.contact_id || null,
      customer_company_id: recipient.company_id || null,
      customer_company: recipient.company || null,
      customer_name: recipient.name || null,
      customer_email: recipient.email || null,
      customer_address: recipient.address || null,
      salutation: salutation || null,
      subject: subject || null,
      routes: routes.map((r) => r.trim()).filter(Boolean),
      cargo_length: cargoLength || null,
      cargo_weight: cargoWeight || null,
      cargo_diameter: cargoDiameter || null,
      survey_timeline: surveyTimeline || null,
      delivery: delivery || null,
      total: num(total, 0),
      payment_terms: paymentTerms || null,
      letter_signatory_name: letterName || null,
      letter_signatory_title: letterTitle || null,
      offer_signatory_name: offerName || null,
      offer_signatory_title: offerTitle || null,
      notes: notes || null,
    };
  }

  function validate(): string | null {
    if (!recipient.company && !recipient.name) return "Enter a recipient company or attention name.";
    if (!routes.some((r) => r.trim())) return "Add at least one route.";
    return null;
  }

  async function preview() {
    if (!routes.some((r) => r.trim())) {
      toast({ title: "Nothing to preview", description: "Add at least one route.", variant: "destructive" });
      return;
    }
    const win = window.open("", "_blank");
    setPreviewing(true);
    try {
      const res = await fetch("/api/offers/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(buildPayload()),
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

  async function save() {
    const err = validate();
    if (err) {
      toast({ title: "Check the form", description: err, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save offer");
      toast({ title: "Draft saved", description: `Offer ${json.offer_number} created.` });
      router.push("/portal/offers");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-5xl mx-auto">
        <button
          onClick={() => router.push("/portal/offers")}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to offers
        </button>

        <SectionHeader
          title="New LBI Route-Survey Offer"
          description="Fill the dynamic fields below — scope of work, methodology, banking and terms are added from the fixed template."
        >
          {null}
        </SectionHeader>

        <div className="flex items-center justify-end mb-4">
          <a href="/portal/invoices/settings" className="text-xs text-gray-400 hover:text-emerald-400 underline">
            Edit seller / bank / logo settings →
          </a>
        </div>

        <div className="space-y-6">
          {/* Recipient */}
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Recipient</h2>
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
                <span className="text-xs text-gray-500">Or just type the recipient details below.</span>
                {selectedContact && (
                  <button type="button" onClick={clearContact} className="text-xs text-gray-400 hover:text-emerald-400">
                    Clear selection
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Company (M/s …)</label>
                <input className={inputCls} value={recipient.company} onChange={(e) => setRecipient({ ...recipient, company: e.target.value })} placeholder="Kuehne + Nagel Pvt. Ltd." />
              </div>
              <div>
                <label className={labelCls}>Kind Attention (contact person)</label>
                <input className={inputCls} value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} placeholder="Mr. Somnath Ganguly" />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input className={inputCls} type="email" value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} placeholder="buyer@company.com" />
              </div>
              <div>
                <label className={labelCls}>Salutation</label>
                <input className={inputCls} value={salutation} onChange={(e) => setSalutation(e.target.value)} placeholder="Dear Sir" />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Address (one line per row)</label>
                <textarea className={inputCls} rows={3} value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} placeholder={"Chandivali Road, Near Chandivali Studio, B-2 / 601,\nBoomerang, Andheri East\nMumbai, MH 400072, India"} />
              </div>
            </div>
          </section>

          {/* Offer meta */}
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Offer details</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="col-span-2 md:col-span-3">
                <label className={labelCls}>Template</label>
                <div className="flex items-center gap-2">
                  <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {templates.length === 0 && <option value="">Default template</option>}
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.is_default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                  <a
                    href="/portal/offers/templates"
                    className="whitespace-nowrap text-xs text-emerald-400 hover:underline"
                    title="Create or edit offer templates"
                  >
                    Manage templates →
                  </a>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Pick the layout/wording. All templates use the same fields below.
                </p>
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className={labelCls}>Quote No. (optional — auto if blank)</label>
                <input className={inputCls} value={offerNumber} onChange={(e) => setOfferNumber(e.target.value)} placeholder="RIPL/LBI/VK/024/26-27" />
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
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
                <label className={labelCls}>Service tax note (%)</label>
                <input className={inputCls} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className={labelCls}>Validity (days)</label>
                <input className={inputCls} value={validityDays} onChange={(e) => setValidityDays(e.target.value)} inputMode="numeric" />
              </div>
            </div>
          </section>

          {/* Routes */}
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Routes</h2>
              <button onClick={addRoute} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm">
                <Plus className="w-4 h-4" /> Add route
              </button>
            </div>
            <div className="space-y-3">
              {routes.map((r, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-5 text-right">{idx + 1}.</span>
                  <input
                    className={inputCls}
                    value={r}
                    onChange={(e) => updateRoute(idx, e.target.value)}
                    placeholder="ISGEC – Yamunanagar, Haryana"
                  />
                  <button onClick={() => removeRoute(idx)} disabled={routes.length === 1} className="p-2 rounded-lg hover:bg-gray-700 text-red-400 disabled:opacity-30" title="Remove route">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <label className={labelCls}>Reference sentence (optional — defaults to the route list joined together)</label>
              <textarea className={inputCls} rows={2} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ISGEC to Yamunanagar, Haryana, Godrej Process Equipment to Dahej, … Five various locations." />
            </div>
          </section>

          {/* Cargo + commercial */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">Proposed cargo dimensions</h2>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Length</label>
                  <input className={inputCls} value={cargoLength} onChange={(e) => setCargoLength(e.target.value)} placeholder="55m" />
                </div>
                <div>
                  <label className={labelCls}>Weight</label>
                  <input className={inputCls} value={cargoWeight} onChange={(e) => setCargoWeight(e.target.value)} placeholder="150 MT" />
                </div>
                <div>
                  <label className={labelCls}>Diameter</label>
                  <input className={inputCls} value={cargoDiameter} onChange={(e) => setCargoDiameter(e.target.value)} placeholder="5m" />
                </div>
              </div>
              <p className="text-xs text-gray-500">Leave blank to omit the "Proposed dimensions" line from the scope.</p>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">Commercial</h2>
              <div>
                <label className={labelCls}>Total cost ({currency})</label>
                <input className={inputCls} value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="390000" />
                <p className="text-xs text-gray-500 mt-1">{formatMoney(num(total, 0), currency)} — one combined cost for all routes.</p>
              </div>
              <div>
                <label className={labelCls}>Survey & report timeline</label>
                <input className={inputCls} value={surveyTimeline} onChange={(e) => setSurveyTimeline(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Delivery</label>
                <input className={inputCls} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Payment terms</label>
                <textarea className={inputCls} rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
              </div>
            </div>
          </section>

          {/* Signatories */}
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Signatories</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Cover letter</p>
                <div>
                  <label className={labelCls}>Name</label>
                  <input className={inputCls} value={letterName} onChange={(e) => setLetterName(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Title</label>
                  <input className={inputCls} value={letterTitle} onChange={(e) => setLetterTitle(e.target.value)} />
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Commercial offer</p>
                <div>
                  <label className={labelCls}>Name</label>
                  <input className={inputCls} value={offerName} onChange={(e) => setOfferName(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Title</label>
                  <input className={inputCls} value={offerTitle} onChange={(e) => setOfferTitle(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className={labelCls}>Notes (optional)</label>
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Letterhead, banking, logo &amp; email come from your{" "}
              <a href="/portal/invoices/settings" className="text-emerald-400 underline">seller settings</a>.
            </p>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pb-10">
            <button onClick={preview} disabled={previewing || saving} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium disabled:opacity-50">
              <Eye className="w-4 h-4" /> {previewing ? "Rendering…" : "Preview"}
            </button>
            <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save draft"}
            </button>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
