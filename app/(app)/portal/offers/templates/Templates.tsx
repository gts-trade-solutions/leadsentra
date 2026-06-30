"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Pencil, Trash2, Copy, Star, ChevronUp, ChevronDown, Save, X, Eye, Type, Heading, List, MoveVertical, FileText, RotateCcw,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_LBI_BLOCKS } from "@/lib/offerTemplate";

type Block = any;
type Template = { id: string; name: string; is_default: boolean; content: Block[] };

// Friendly field picker — label the user understands -> placeholder token.
const FIELDS: Array<[string, string]> = [
  ["Offer date", "{{date}}"],
  ["Quote number", "{{quote_no}}"],
  ["Your company", "{{seller_company}}"],
  ["Recipient company", "{{recipient_company}}"],
  ["Attention person", "{{attention}}"],
  ["Recipient address", "{{recipient_address}}"],
  ["Recipient email", "{{recipient_email}}"],
  ["Salutation", "{{salutation}}"],
  ["Route list (sentence)", "{{subject_routes}}"],
  ["Cargo dimensions", "{{cargo_dimensions}}"],
  ["Total cost", "{{total}}"],
  ["Total in words", "{{amount_in_words}}"],
  ["Survey timeline", "{{survey_timeline}}"],
  ["Delivery time", "{{delivery}}"],
  ["Payment terms", "{{payment_terms}}"],
  ["Service-tax %", "{{tax_rate}}"],
  ["Validity (days)", "{{validity_days}}"],
  ["Letter signatory name", "{{letter_signatory_name}}"],
  ["Letter signatory title", "{{letter_signatory_title}}"],
  ["Commercial signatory name", "{{offer_signatory_name}}"],
  ["Commercial signatory title", "{{offer_signatory_title}}"],
  ["Notes", "{{notes}}"],
];

// Plain-language section names.
const SECTION_LABELS: Record<string, string> = {
  paragraph: "Text paragraph",
  heading: "Heading",
  bullets: "List of points",
  quote_no: "Quote-number line",
  spacer: "Blank space",
  page_break: "Start a new page",
  letterhead: "Your letterhead",
  routes_table: "Route & cost table",
  banking: "Bank details",
};

const SECTION_HELP: Record<string, string> = {
  letterhead: "Auto-filled: your logo and company address (from seller settings).",
  routes_table: "Auto-filled: the Sl./Route/Timeline/Cost table from the offer's routes.",
  banking: "Auto-filled: your bank details (from seller settings).",
  page_break: "Everything after this starts on a fresh page.",
  spacer: "Adds an empty vertical gap.",
};

const ADD_MENU: Array<{ group: string; items: Array<{ value: string; label: string }> }> = [
  {
    group: "Content",
    items: [
      { value: "heading", label: "Heading" },
      { value: "paragraph", label: "Text paragraph" },
      { value: "bullets", label: "List of points" },
      { value: "quote_no", label: "Quote-number line" },
    ],
  },
  {
    group: "Layout",
    items: [
      { value: "spacer", label: "Blank space" },
      { value: "page_break", label: "Start a new page" },
    ],
  },
  {
    group: "Auto-filled (from the offer / your settings)",
    items: [
      { value: "letterhead", label: "Your letterhead" },
      { value: "routes_table", label: "Route & cost table" },
      { value: "banking", label: "Bank details" },
    ],
  },
];

/** A short preview of a section's content, used as the auto title when unlabeled. */
function contentPreview(b: Block): string {
  const clip = (s: string) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > 52 ? `${t.slice(0, 52)}…` : t;
  };
  switch (b.type) {
    case "paragraph": return clip(b.text) || "Empty paragraph";
    case "heading": return clip(b.text) || "Heading";
    case "quote_no": return clip(b.text) || "Quote-number line";
    case "bullets": return `List — ${(b.items || []).length} point(s)`;
    default: return SECTION_LABELS[b.type] || b.type;
  }
}

/** The title shown in the section header: the editor label, else a content preview. */
function sectionTitle(b: Block): string {
  return (b.label && String(b.label).trim()) || contentPreview(b);
}

function newBlock(type: string): Block {
  switch (type) {
    case "heading": return { type, text: "Heading text", level: 2, align: "left" };
    case "bullets": return { type, items: ["First point"], ordered: false };
    case "quote_no": return { type, text: "Quote No. {{quote_no}}" };
    case "spacer": return { type, size: 8 };
    case "paragraph": return { type, text: "", bold: false, italic: false, muted: false, align: "left" };
    default: return { type };
  }
}

const inputCls =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600";
const labelCls = "block text-xs font-medium text-gray-400 mb-1";

export default function OfferTemplates() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/offer-templates", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      setTemplates(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setEditing({
      id: "",
      name: "New template",
      is_default: false,
      content: [
        { type: "letterhead", label: "Letterhead" },
        { type: "paragraph", text: "{{date}}", label: "Offer date" },
        { type: "paragraph", text: "{{recipient_company}}", bold: true, label: "Recipient — company" },
        { type: "paragraph", text: "{{salutation}}", label: "Salutation" },
      ],
    });
  }

  function startDuplicate(t: Template) {
    setEditing({ id: "", name: `${t.name} (copy)`, is_default: false, content: JSON.parse(JSON.stringify(t.content || [])) });
  }

  async function setDefault(t: Template) {
    try {
      const res = await fetch(`/api/offer-templates/${t.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
      toast({ title: "Default template set", description: t.name });
      load();
    } catch (e: any) {
      toast({ title: "Could not set default", description: e?.message || String(e), variant: "destructive" });
    }
  }

  async function remove(t: Template) {
    if (!confirm(`Delete template "${t.name}"? Offers already created keep their saved layout.`)) return;
    try {
      const res = await fetch(`/api/offer-templates/${t.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
      toast({ title: "Template deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Could not delete", description: e?.message || String(e), variant: "destructive" });
    }
  }

  return (
    <AuthGuard>
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => router.push("/portal/offers")} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to offers
        </button>
        <SectionHeader title="Offer Templates" description="These are the layouts you can pick from the offer builder's template dropdown.">
          <button onClick={startNew} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> New template
          </button>
        </SectionHeader>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">{t.name}</span>
                    {t.is_default && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-600/20 text-emerald-400">
                        <Star className="w-3 h-3" /> default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{(t.content || []).length} section(s)</div>
                </div>
                {!t.is_default && (
                  <button onClick={() => setDefault(t)} title="Set as default" className="p-2 rounded-lg hover:bg-gray-700 text-gray-300">
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => startDuplicate(t)} title="Duplicate" className="p-2 rounded-lg hover:bg-gray-700 text-gray-300">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => setEditing(t)} title="Edit" className="p-2 rounded-lg hover:bg-gray-700 text-gray-300">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => remove(t)} title="Delete" className="p-2 rounded-lg hover:bg-gray-700 text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </AuthGuard>
  );
}

/** Insert a {{token}} at the caret of an input/textarea, keeping focus. */
function useFieldInsert(
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
  value: string,
  onChange: (v: string) => void
) {
  return (token: string) => {
    const el = ref.current;
    if (!el) { onChange(`${value}${token}`); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      try { el.setSelectionRange(pos, pos); } catch {}
    });
  };
}

function FieldPicker({ onPick }: { onPick: (token: string) => void }) {
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
        e.target.value = "";
      }}
      className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-emerald-300 hover:border-emerald-600"
      title="Insert a detail that fills in automatically"
    >
      <option value="">+ Insert field…</option>
      {FIELDS.map(([label, token]) => (
        <option key={token} value={token}>{label}</option>
      ))}
    </select>
  );
}

function InsertableTextarea({
  value, onChange, rows = 2, placeholder, mono,
}: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = useFieldInsert(ref, value, onChange);
  return (
    <div>
      <div className="flex justify-end mb-1"><FieldPicker onPick={insert} /></div>
      <textarea
        ref={ref}
        className={`${inputCls} ${mono ? "font-mono" : ""}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function InsertableInput({
  value, onChange, placeholder,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const insert = useFieldInsert(ref, value, onChange);
  return (
    <div>
      <div className="flex justify-end mb-1"><FieldPicker onPick={insert} /></div>
      <input ref={ref} className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TemplateEditor({
  template, onClose, onSaved,
}: {
  template: Template; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [isDefault, setIsDefault] = useState(template.is_default);
  const [blocks, setBlocks] = useState<Block[]>(template.content || []);
  const [addType, setAddType] = useState("paragraph");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  function patch(i: number, p: Partial<Block>) {
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }
  function move(i: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeAt(i: number) {
    setBlocks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setBlocks((prev) => [...prev, newBlock(addType)]);
  }

  async function preview() {
    const win = window.open("", "_blank");
    setPreviewing(true);
    try {
      const sample = {
        template_content: blocks,
        offer_number: "SAMPLE/001/26-27",
        issue_date: new Date().toISOString().slice(0, 10),
        currency: "INR",
        customer_company: "Sample Customer Pvt. Ltd.",
        customer_name: "Mr. Sample Contact",
        customer_address: "123 Sample Street,\nSample Area\nSample City - 000000",
        salutation: "Dear Sir",
        routes: ["Origin A to Destination B", "Origin C to Destination D"],
        cargo_length: "55m", cargo_weight: "150 MT", cargo_diameter: "5m",
        survey_timeline: "4-6 weeks for the completion of survey and reporting",
        delivery: "4-6 weeks", total: 390000, tax_rate: 18,
        payment_terms: "60% advance, 20% against survey completion, 20% against report submission.",
        validity_days: 15,
        letter_signatory_name: "Signatory Name", letter_signatory_title: "Managing Director",
        offer_signatory_name: "Signatory Name", offer_signatory_title: "Business Head",
      };
      const res = await fetch("/api/offers/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(sample),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Preview failed");
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
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!blocks.length) { toast({ title: "Add at least one section", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), is_default: isDefault, content: blocks };
      const res = await fetch(template.id ? `/api/offer-templates/${template.id}` : "/api/offer-templates", {
        method: template.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      toast({ title: template.id ? "Template saved" : "Template created" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 top-6 mx-auto w-[min(960px,96%)] rounded-2xl bg-gray-900 border border-gray-700 shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{template.id ? "Edit template" : "New template"}</h3>
          <button onClick={onClose} className="text-gray-300 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {/* How it works */}
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 text-xs text-emerald-100/90">
            A template is your offer document split into <b>sections</b>. Edit the wording in each section. Where you want a
            detail to fill in automatically (recipient name, total, dates…), click <b>“+ Insert field”</b> instead of typing it.
            Use <b>Preview</b> any time to see how it looks.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}>Template name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TECHNIC – Engineering Survey" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-gray-300">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-emerald-600" />
              Use as default
            </label>
          </div>

          {/* Sections */}
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <SectionRow
                key={i}
                block={b}
                index={i}
                total={blocks.length}
                onPatch={(p) => patch(i, p)}
                onMove={(d) => move(i, d)}
                onRemove={() => removeAt(i)}
              />
            ))}
            {blocks.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
                No sections yet — add one below.
              </div>
            )}
          </div>

          {/* Add section */}
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
            <span className="text-xs text-gray-400">Add a section:</span>
            <select className={`${inputCls} max-w-xs`} value={addType} onChange={(e) => setAddType(e.target.value)}>
              {ADD_MENU.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((it) => (
                    <option key={it.value} value={it.value}>{it.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button onClick={add} className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm">
              <Plus className="w-4 h-4" /> Add
            </button>
            <button
              onClick={() => {
                if (confirm("Replace all sections with the default LBI layout (with section titles)? This discards the current sections.")) {
                  setBlocks(JSON.parse(JSON.stringify(DEFAULT_LBI_BLOCKS)));
                }
              }}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-300 rounded-lg text-sm"
              title="Load the built-in LBI layout, with a clear title on every section"
            >
              <RotateCcw className="w-4 h-4" /> Load labeled default
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-gray-700 flex items-center justify-between gap-2">
          <button onClick={preview} disabled={previewing} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm disabled:opacity-60">
            <Eye className="w-4 h-4" /> {previewing ? "Rendering…" : "Preview"}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm">Cancel</button>
            <button onClick={save} disabled={busy} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60">
              <Save className="w-4 h-4" /> {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 text-emerald-300";
  if (type === "heading") return <Heading className={cls} />;
  if (type === "paragraph") return <Type className={cls} />;
  if (type === "bullets") return <List className={cls} />;
  if (type === "spacer") return <MoveVertical className={cls} />;
  return <FileText className={cls} />;
}

function SectionRow({
  block, index, total, onPatch, onMove, onRemove,
}: {
  block: Block; index: number; total: number;
  onPatch: (p: Partial<Block>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const typeLabel = SECTION_LABELS[block.type] || block.type;
  const help = SECTION_HELP[block.type];
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="shrink-0"><SectionIcon type={block.type} /></span>
          <input
            className="flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-gray-700 focus:border-emerald-600 text-sm font-semibold text-white px-0 py-0.5 focus:outline-none"
            value={block.label || ""}
            placeholder={contentPreview(block)}
            onChange={(e) => onPatch({ label: e.target.value })}
            title="Section title — rename it so it's easy to find. (Shown only here, not in the PDF.)"
          />
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500 whitespace-nowrap border border-gray-700 rounded px-1.5 py-0.5">
            {typeLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-30" title="Move up">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-30" title="Move down">
            <ChevronDown className="w-4 h-4" />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded hover:bg-gray-700 text-red-400" title="Remove section">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {help && <p className="text-xs text-gray-500 mb-1">{help}</p>}

      {block.type === "paragraph" && (
        <div className="space-y-2">
          <InsertableTextarea value={block.text || ""} onChange={(v) => onPatch({ text: v })} rows={2} placeholder="Type the wording here…" />
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!block.bold} onChange={(e) => onPatch({ bold: e.target.checked })} className="accent-emerald-600" /> Bold</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={block.align === "center"} onChange={(e) => onPatch({ align: e.target.checked ? "center" : "left" })} className="accent-emerald-600" /> Centered</label>
            <details className="ml-auto">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-300">More</summary>
              <div className="mt-1 flex items-center gap-3">
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!block.italic} onChange={(e) => onPatch({ italic: e.target.checked })} className="accent-emerald-600" /> Italic</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!block.muted} onChange={(e) => onPatch({ muted: e.target.checked })} className="accent-emerald-600" /> Light grey</label>
                <label className="flex items-center gap-1">
                  Align
                  <select className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5" value={block.align || "left"} onChange={(e) => onPatch({ align: e.target.value })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </div>
            </details>
          </div>
        </div>
      )}

      {block.type === "heading" && (
        <div className="space-y-2">
          <InsertableInput value={block.text || ""} onChange={(v) => onPatch({ text: v })} placeholder="Heading text" />
          <div className="flex items-center gap-3 text-xs text-gray-300">
            <label className="flex items-center gap-1">
              Size
              <select className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5" value={block.level || 2} onChange={(e) => onPatch({ level: Number(e.target.value) })}>
                <option value={1}>Large</option>
                <option value={2}>Medium</option>
                <option value={3}>Small</option>
              </select>
            </label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={block.align === "center"} onChange={(e) => onPatch({ align: e.target.checked ? "center" : "left" })} className="accent-emerald-600" /> Centered</label>
          </div>
        </div>
      )}

      {block.type === "bullets" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">One point per line.</p>
          <InsertableTextarea
            value={(block.items || []).join("\n")}
            onChange={(v) => onPatch({ items: v.split("\n") })}
            rows={4}
            mono
            placeholder={"First point\nSecond point"}
          />
          <label className="flex items-center gap-1 text-xs text-gray-300">
            <input type="checkbox" checked={!!block.ordered} onChange={(e) => onPatch({ ordered: e.target.checked })} className="accent-emerald-600" />
            Numbered list (a, b, c…). Tip: text before a colon is shown in bold.
          </label>
        </div>
      )}

      {block.type === "quote_no" && (
        <InsertableInput value={block.text || ""} onChange={(v) => onPatch({ text: v })} placeholder="Quote No. {{quote_no}}" />
      )}

      {block.type === "spacer" && (
        <div className="flex items-center gap-2 text-xs text-gray-300">
          <span>Gap height</span>
          <input className={`${inputCls} max-w-[120px]`} type="number" min={0} max={80} value={block.size ?? 8} onChange={(e) => onPatch({ size: Number(e.target.value) })} />
        </div>
      )}
    </div>
  );
}
