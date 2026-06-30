"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Send,
  Paperclip,
  Tag,
  Building2,
  FileText,
  X,
} from "lucide-react";
import SectionHeader from "@/components/SectionHeader";
import EmptyState from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";

// sessionStorage key the campaign composer reads to prefill a send.
const HANDOFF_KEY = "leadsentra:catalogue_send";

type CompanyOpt = { company_id: string; name: string };

type CatItem = {
  id: string;
  kind: "catalogue" | "offer";
  title: string;
  subject: string | null;
  body: string | null;
  company_id: string | null;
  department: string | null;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at?: string;
};

const ALL_COMPANIES = ""; // company select value meaning "overall / all companies"

export default function CataloguesPage() {
  const router = useRouter();

  // Targeting selection
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState<string>(ALL_COMPANIES);
  const [departments, setDepartments] = useState<string[]>([]);
  const [department, setDepartment] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<"" | "catalogue" | "offer">("");

  // Library
  const [items, setItems] = useState<CatItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal (create / edit)
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const companyName = useMemo(
    () => companies.find((c) => c.company_id === companyId)?.name || "",
    [companies, companyId]
  );

  // ---- loaders ----
  const loadCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/companies", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      const list: CompanyOpt[] = (Array.isArray(json?.data) ? json.data : [])
        .map((c: any) => ({ company_id: c.company_id, name: c.name || c.company_name || c.company_id }))
        .sort((a: CompanyOpt, b: CompanyOpt) => a.name.localeCompare(b.name));
      setCompanies(list);
    } catch {
      setCompanies([]);
    }
  }, []);

  // Load the chosen company's departments (from the full record's meta).
  const loadDepartments = useCallback(async (id: string) => {
    if (!id) {
      setDepartments([]);
      return;
    }
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(id)}/full`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      const c = json?.company || {};
      setDepartments(Array.isArray(c?.departments) ? c.departments : []);
    } catch {
      setDepartments([]);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const u = new URL("/api/catalogues", window.location.origin);
      u.searchParams.set("scoped", "1");
      if (companyId) u.searchParams.set("company_id", companyId);
      if (department) u.searchParams.set("department", department);
      if (kindFilter) u.searchParams.set("kind", kindFilter);
      const res = await fetch(u.toString(), { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, department, kindFilter]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // When the company changes: refresh its departments and reset the dept pick.
  useEffect(() => {
    setDepartment("");
    loadDepartments(companyId);
  }, [companyId, loadDepartments]);

  // Auto-show matching items whenever the targeting selection changes.
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // ---- delete ----
  async function remove(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/catalogues/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Delete failed");
      }
      toast({ title: "Deleted" });
      loadItems();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message });
    }
  }

  // ---- send: hand off to the campaign composer, prefilled ----
  function send(item: CatItem) {
    // Build the email HTML: the saved body, plus a "Download" button when a
    // file is attached. Big attachments hurt deliverability, so we link to the
    // file (served publicly) instead of attaching raw bytes.
    let html = item.body || "";
    if (item.file_path) {
      const absolute = `${window.location.origin}${item.file_path}`;
      const label = item.kind === "offer" ? "View offer" : "Download catalogue";
      html +=
        `\n<p style="margin-top:24px">` +
        `<a href="${absolute}" ` +
        `style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;` +
        `padding:12px 20px;border-radius:8px;font-weight:600">${label}: ${escapeHtml(
          item.file_name || item.title
        )}</a></p>`;
    }

    const handoff = {
      source: "catalogue",
      title: item.title,
      subject: item.subject || item.title,
      html,
      company_id: companyId || "",
      company_name: companyName,
      department: department || "",
    };
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      /* ignore quota errors — composer will just open empty */
    }
    router.push("/portal/campaigns/new");
  }

  const targetingLabel = companyId
    ? `${companyName}${department ? ` › ${department}` : " › all departments"}`
    : "All companies (overall)";

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Catalogues & Offers"
        description="Save catalogues and offers, tag them to a company and department, then send them."
      >
        <button
          onClick={() => router.push("/portal/offers")}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
          title="Build a RACE INTELLECT (LBI) route-survey offer as a PDF"
        >
          <FileText className="w-4 h-4" />
          LBI route-survey offer
        </button>
        <button
          onClick={() => {
            setEditId(null);
            setModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New catalogue / offer
        </button>
      </SectionHeader>

      {/* Targeting bar */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
            >
              <option value={ALL_COMPANIES}>All companies (overall)</option>
              {companies.map((c) => (
                <option key={c.company_id} value={c.company_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={!companyId}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm disabled:opacity-50"
            >
              <option value="">{companyId ? "All departments" : "—"}</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {companyId && departments.length === 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                This company has no departments yet — add them on the Companies page.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Type</label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
            >
              <option value="">Catalogues & offers</option>
              <option value="catalogue">Catalogues only</option>
              <option value="offer">Offers only</option>
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-400 flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          Showing saved items for: <b className="text-gray-200">{targetingLabel}</b>
        </div>
      </div>

      {/* Items */}
      {loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No catalogues or offers here yet"
          description={
            companyId
              ? `Nothing saved for ${targetingLabel}. Create one, or pick a different company/department.`
              : "Create your first catalogue or offer. Tag it to a company and department so it shows up here."
          }
          primary={{
            label: "New catalogue / offer",
            onClick: () => {
              setEditId(null);
              setModalOpen(true);
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => (
            <CatalogueCard
              key={item.id}
              item={item}
              companyName={companies.find((c) => c.company_id === item.company_id)?.name}
              onEdit={() => {
                setEditId(item.id);
                setModalOpen(true);
              }}
              onDelete={() => remove(item.id)}
              onSend={() => send(item)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <CatalogueModal
          editId={editId}
          companies={companies}
          defaultCompanyId={companyId}
          defaultDepartment={department}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            loadItems();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Card ---------------- */

function CatalogueCard({
  item,
  companyName,
  onEdit,
  onDelete,
  onSend,
}: {
  item: CatItem;
  companyName?: string;
  onEdit: () => void;
  onDelete: () => void;
  onSend: () => void;
}) {
  const isOffer = item.kind === "offer";
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${
              isOffer
                ? "bg-amber-900/40 text-amber-200 border border-amber-700"
                : "bg-emerald-900/40 text-emerald-200 border border-emerald-700"
            }`}
          >
            <Tag className="w-3 h-3" />
            {isOffer ? "Offer" : "Catalogue"}
          </span>
          <h3 className="text-white font-semibold mt-2 break-words">{item.title}</h3>
        </div>
      </div>

      {item.subject && (
        <div className="text-xs text-gray-400 mt-1 truncate" title={item.subject}>
          Subject: {item.subject}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-800 border border-gray-700 text-gray-300">
          <Building2 className="w-3 h-3" />
          {item.company_id ? companyName || "Company" : "All companies"}
        </span>
        {item.department && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-800 border border-gray-700 text-gray-300">
            {item.department}
          </span>
        )}
      </div>

      {item.file_path && (
        <a
          href={item.file_path}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline break-all"
        >
          <Paperclip className="w-3.5 h-3.5 flex-shrink-0" />
          {item.file_name || "Attached file"}
        </a>
      )}

      <div className="mt-4 pt-3 border-t border-gray-800 flex items-center gap-2">
        <button
          onClick={onSend}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
        >
          <Send className="w-3.5 h-3.5" /> Send
        </button>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs"
        >
          <Pencil className="w-3.5 h-3.5" /> Edit
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-rose-900/40 hover:border-rose-700 text-gray-200 hover:text-rose-200 text-xs ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Create / Edit modal ---------------- */

function CatalogueModal({
  editId,
  companies,
  defaultCompanyId,
  defaultDepartment,
  onClose,
  onSaved,
}: {
  editId: string | null;
  companies: CompanyOpt[];
  defaultCompanyId: string;
  defaultDepartment: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [kind, setKind] = useState<"catalogue" | "offer">("catalogue");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [department, setDepartment] = useState(defaultDepartment);
  const [departments, setDepartments] = useState<string[]>([]);
  const [existingFile, setExistingFile] = useState<{ name: string; path: string } | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load departments for the selected company.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!companyId) {
        setDepartments([]);
        return;
      }
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/full`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          const d = json?.company?.departments;
          setDepartments(Array.isArray(d) ? d : []);
        }
      } catch {
        if (!cancelled) setDepartments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Prefill when editing.
  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    fetch("/api/catalogues?scoped=0", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        const found = (Array.isArray(j?.items) ? j.items : []).find(
          (x: CatItem) => x.id === editId
        );
        if (found) {
          setKind(found.kind === "offer" ? "offer" : "catalogue");
          setTitle(found.title || "");
          setSubject(found.subject || "");
          setBody(found.body || "");
          setCompanyId(found.company_id || "");
          setDepartment(found.department || "");
          if (found.file_path) setExistingFile({ name: found.file_name || "file", path: found.file_path });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [editId]);

  async function save() {
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("title", title.trim());
      fd.set("subject", subject.trim());
      fd.set("body", body);
      fd.set("company_id", companyId);
      fd.set("department", department);
      const file = fileRef.current?.files?.[0];
      if (file) fd.set("file", file);
      if (removeFile && !file) fd.set("remove_file", "1");

      const res = await fetch(
        editId ? `/api/catalogues/${encodeURIComponent(editId)}` : "/api/catalogues",
        { method: editId ? "PATCH" : "POST", body: fd, credentials: "same-origin" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Save failed");
      toast({ title: editId ? "Saved" : "Created" });
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500";
  const labelCls = "text-xs text-gray-400 block mb-1";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 top-8 mx-auto w-[min(820px,95%)] rounded-2xl bg-gray-900 border border-gray-700 shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">
            {editId ? "Edit catalogue / offer" : "New catalogue / offer"}
          </h3>
          <button onClick={onClose} className="text-gray-300 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          {err && (
            <div className="text-sm text-rose-300 border border-rose-700/50 bg-rose-950/40 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          {loading && <div className="text-sm text-gray-400">Loading…</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Type</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as any)}
                className={fieldCls}
              >
                <option value="catalogue">Catalogue</option>
                <option value="offer">Offer</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>
                Title <span className="text-rose-400">*</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. LBI Product Catalogue 2026"
                className={fieldCls}
              />
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setDepartment("");
                }}
                className={fieldCls}
              >
                <option value="">All companies (overall)</option>
                {companies.map((c) => (
                  <option key={c.company_id} value={c.company_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Department</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                disabled={!companyId}
                className={`${fieldCls} disabled:opacity-50`}
              >
                <option value="">{companyId ? "All departments" : "—"}</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Email subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject recipients will see"
              className={fieldCls}
            />
          </div>

          <div>
            <label className={labelCls}>Email message (HTML allowed)</label>
            <textarea
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"<p>Hi {{name}},</p>\n<p>Please find our latest catalogue below.</p>"}
              className={`${fieldCls} font-mono text-sm`}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              When you send, the attached file appears as a download button at the bottom of the email.
            </p>
          </div>

          <div>
            <label className={labelCls}>Attachment (PDF, image, etc. — max 25 MB)</label>
            {existingFile && !removeFile && (
              <div className="mb-2 flex items-center gap-2 text-xs text-gray-300">
                <Paperclip className="w-3.5 h-3.5" />
                <a href={existingFile.path} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline break-all">
                  {existingFile.name}
                </a>
                <button
                  type="button"
                  onClick={() => setRemoveFile(true)}
                  className="text-rose-300 hover:text-rose-200"
                >
                  Remove
                </button>
              </div>
            )}
            {removeFile && (
              <div className="mb-2 text-xs text-amber-300">
                File will be removed on save.{" "}
                <button type="button" onClick={() => setRemoveFile(false)} className="underline">
                  Undo
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              className="block w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
            />
          </div>
        </div>

        <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !title.trim()}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : editId ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
