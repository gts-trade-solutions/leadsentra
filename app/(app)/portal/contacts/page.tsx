"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SectionHeader from "@/components/SectionHeader";
import Table from "@/components/Table";
import EmptyState from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthProvider";
import { CardScanButton, type ScanExtracted } from "@/components/CardScanButton";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import { externalUrl } from "@/lib/url";
import { readUploadResponse } from "@/lib/uploadError";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import PhoneInput from "@/components/PhoneInput";

import {
  getMySender,
  startEmailVerify,
  checkEmailStatus,
  changesLeft,
  type EmailIdentityRow,
} from "@/lib/sender";

import {
  Plus,
  Upload,
  Facebook,
  Instagram,
  Linkedin,
  Globe,
  Search as SearchIcon,
  SortAsc,
  SortDesc,
  Lock,
  LockOpen,
  Shield,
  ShieldAlert,
  Wallet,
  Send,
  Eye,
  MousePointerClick,
  ShieldCheck,
  RefreshCcw,
  AlertTriangle,
  Pencil,
  Trash2,
} from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */

type Row = {
  id: string;
  name: string;
  // 'lead' = mailable in lead-generation campaigns; 'normal' = CRM-only.
  contact_type?: string | null;
  title: string;
  company: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  // Extracted from contacts.meta JSON by the GET /api/contacts query so the
  // table can display the columns the CSV upload template asks for.
  department: string | null;
  notes: string | null;
  country: string | null;        // joined from companies.country
  segment: string | null;        // joined from companies.segment
  company_type: string | null;   // joined from companies.company_type/industry
  created_at?: string | null;    // ISO timestamp
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  is_unlocked: boolean;
};

type ContactRow = {
  contact_id: string;
  contact_name: string | null;
  email: string;
};

type OneoffRow = {
  id: string;
  contact_id: string | null;
  email: string;
  from_email: string;
  subject: string;
  status: string;
  message_id: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  last_event_at: string | null;
  opens_count: number;
  clicks_count: number;
  error: string | null;
};

type CompanyRef = { company_id: string; company_name: string };

/* ───────────────────────── Component ───────────────────────── */

export default function ContactsPage() {

  // Admin-only "Select" column drives the bulk-delete flow. Hidden for
  // moderators and regular users so the checkboxes don't visually suggest a
  // capability they don't have.
  // (isAdmin is declared just below; the headers list is recomputed each
  // render so reading it here is fine.)

  // sender / verify
  const [mySender, setMySender] = useState<EmailIdentityRow | null>(null);
  const [fromEmail, setFromEmail] = useState("");
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [verStatus, setVerStatus] = useState<
    "idle" | "pending" | "verified" | "failed" | "error"
  >("idle");
  const latestStatus =
    verStatus !== "idle" ? verStatus : (mySender?.status as any) ?? "idle";
  const isVerified = latestStatus === "verified";
  const left = changesLeft(mySender, 2);

  // send modal
  const [openSend, setOpenSend] = useState(false);
  const [target, setTarget] = useState<ContactRow | null>(null);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");

  // tracking modal
  const [openTrack, setOpenTrack] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackRows, setTrackRows] = useState<OneoffRow[]>([]);

  // misc ui
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<null | {
    kind: "success" | "error" | "info" | "warn";
    msg: string;
  }>(null);

  // data & ui state
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // auth/portal (from shared AuthProvider context)
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Staff (admin + moderator) bypass the unlock/credit flow entirely.
  const isStaffUser = isAdmin || user?.role === "moderator";

  // wallet
  const [wallet, setWallet] = useState<number | null>(null);

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<15 | 30 | 50>(15);
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, rows.length);

  // How many contacts exist in total (from the API's COUNT, not the capped
  // page of rows the table is showing).
  const [totalContacts, setTotalContacts] = useState<number | null>(null);

  // search/filters/sort
  const [search, setSearch] = useState("");
  // title / company / country / segment / companyType hold MANY values (empty
  // array = no filter) and render as searchable multi-selects — the option
  // lists run to hundreds of entries once companies are imported.
  const [filters, setFilters] = useState<{
    title: string[];
    company: string[];
    status: "all" | "locked" | "unlocked";
    /** "lead" = only contacts ticked as lead contacts; "normal" = only the
     *  CRM-only ones that campaigns never mail. */
    kind: "all" | "lead" | "normal";
    country: string[];
    segment: string[];
    companyType: string[];
    dateFrom: string;
    dateTo: string;
  }>({
    title: [],
    company: [],
    status: "all",
    kind: "all",
    country: [],
    segment: [],
    companyType: [],
    dateFrom: "",
    dateTo: "",
  });

  // Per-column header filters — text "contains" search rendered inline under
  // each column header (Name / Email / Title / Company / Location / Phone /
  // Social). Independent of the top-level dropdown filters above, so a user
  // can combine "Company = Bell Equipment" with "Title contains manager".
  // Per-column filters match the CSV upload template exactly:
  //   company_id, contact_name, title, email, phone, linkedin_url
  // Anything not in the template (department, location, notes, social) was
  // removed from the table headers — those fields still exist in the DB and
  // in the add/edit modals, just not as table columns/filters.
  const [columnFilters, setColumnFilters] = useState<{
    name: string;
    email: string;
    title: string;
    company: string;
    phone: string;
    linkedin_url: string;
  }>({
    name: "",
    email: "",
    title: "",
    company: "",
    phone: "",
    linkedin_url: "",
  });
  const [sortKey, setSortKey] = useState<
    "name" | "title" | "company" | "country"
  >("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

  // unlock (single)
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [confirmUnlockId, setConfirmUnlockId] = useState<string | null>(null);

  // bulk unlock
  const [showBulk, setShowBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);

  // Admin-only select-all. "All" = every row passing the current filter
  // (across pages) — that's what the header checkbox is expected to do in
  // bulk-delete tooling. Restricting it to the current page would force the
  // admin to paginate just to delete a filtered result set.
  const filteredIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected =
    !allFilteredSelected && filteredIds.some((id) => selectedIds.has(id));
  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  // Builds a "label + contains filter input" cell for a column header.
  // Inlined as a const-function (not a component) so React doesn't remount
  // the input on every parent re-render — that's what was stealing focus
  // between keystrokes. onMouseDown + onClick stop propagation in case a
  // sort handler is later wired onto the <th>.
  const renderFilterHeader = (
    label: string,
    field: keyof typeof columnFilters,
  ): JSX.Element => (
    <div className="space-y-1.5 min-w-[110px]">
      <div>{label}</div>
      <input
        type="text"
        value={columnFilters[field]}
        onChange={(e) =>
          setColumnFilters((prev) => ({ ...prev, [field]: e.target.value }))
        }
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder="Filter…"
        aria-label={`Filter by ${label.toLowerCase()}`}
        className="w-full px-2 py-1 text-xs font-normal bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  );

  // Table headers. The Select column is admin-only (drives bulk-delete);
  // moderators and regular users get a tidier table without checkboxes.
  const headers: (string | JSX.Element)[] = [
    ...(isAdmin
      ? [
          <SelectAllCheckbox
            key="select-all"
            allChecked={allFilteredSelected}
            someChecked={someFilteredSelected}
            onChange={toggleSelectAll}
            ariaLabel="Select all filtered contacts"
          />,
        ]
      : []),
    renderFilterHeader("Name", "name"),
    renderFilterHeader("Email", "email"),
    renderFilterHeader("Title", "title"),
    renderFilterHeader("Company", "company"),
    renderFilterHeader("Phone", "phone"),
    renderFilterHeader("LinkedIn URL", "linkedin_url"),
    "Type",
    "Actions",
  ];

  // add contact modal
  const [showAdd, setShowAdd] = useState(false);
  const [companies, setCompanies] = useState<CompanyRef[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  // edit contact modal
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    contact_name: "",
    title: "",
    email: "",
    phone: "",
    linkedin_url: "",
    company_id: "",
    contact_type: "lead",
  });

  async function openEdit(r: Row) {
    setEditErr(null);
    setEditingId(r.id);
    setEditForm({
      contact_name: r.name || "",
      title: r.title || "",
      email: r.email || "",
      phone: r.phone || "",
      linkedin_url: r.linkedin_url || "",
      company_id: "", // resolved when companies list loads
      contact_type: r.contact_type === "normal" ? "normal" : "lead",
    });
    // Lazy-load the companies dropdown the first time the user edits a row.
    if (companies.length === 0) {
      try {
        const res = await fetch("/api/companies?limit=100000", { credentials: "same-origin" });
        const j = await res.json().catch(() => ({}));
        const list = Array.isArray(j?.data) ? j.data : [];
        setCompanies(list.map((c: any) => ({ company_id: c.company_id, company_name: c.company_name || c.name || c.company_id })));
        // Best-effort: prefill the select with the row's current company by name
        const match = list.find((c: any) => c.company_name === r.company);
        if (match) setEditForm((f) => ({ ...f, company_id: match.company_id }));
      } catch {
        setCompanies([]);
      }
    } else {
      const match = companies.find((c) => c.company_name === r.company);
      if (match) setEditForm((f) => ({ ...f, company_id: match.company_id }));
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const payload: Record<string, any> = {
        contact_name: editForm.contact_name.trim(),
        title: editForm.title.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        linkedin_url: editForm.linkedin_url.trim(),
        contact_type: editForm.contact_type,
      };
      if (editForm.company_id) payload.company_id = editForm.company_id;
      const res = await fetch(`/api/contacts/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");
      toast({ title: "Contact updated" });
      setEditingId(null);
      await load();
    } catch (e: any) {
      setEditErr(e?.message || "Update failed");
    } finally {
      setEditBusy(false);
    }
  }

  // Inline "+ New company" creator inside the Add Contact modal.  Lets the
  // user create a company without leaving the contact-creation flow.
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyCode, setNewCompanyCode] = useState("");
  const [newCompanyCountry, setNewCompanyCountry] = useState("");
  const [newCompanyBusy, setNewCompanyBusy] = useState(false);
  const [newCompanyErr, setNewCompanyErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    company_id: "",
    contact_type: "lead",
    contact_name: "",
    title: "",
    department: "",
    email: "",
    phone: "",
    location: "",
    notes: "",
    linkedin_url: "",
    facebook_url: "",
    instagram_url: "",
  });

  /* ───────────────────── helpers & loaders ───────────────────── */

  const norm = (v?: string | null) => (v ?? "").toString().trim();
  const includesI = (hay: string, needle: string) =>
    hay.toLowerCase().includes(needle.toLowerCase());

  // Per-column filter matcher. Two modes:
  //   - "-" (just a hyphen) → row passes only when the field is empty/null.
  //     Lets users surface contacts missing data (e.g. "no email yet").
  //   - any other text     → normal case-insensitive contains match.
  // Whitespace around the filter is ignored. The `-` literal is intentionally
  // overloaded here for a one-keystroke "show empty" shortcut. If users ever
  // need to literally search for the hyphen character, they can type "--"
  // (which will fall into the contains branch since it isn't exactly "-").
  const matchColumnFilter = (
    value: string | null | undefined,
    filter: string,
  ): boolean => {
    const trimmed = filter.trim();
    if (!trimmed) return true;
    if (trimmed === "-") return !norm(value);
    return includesI(norm(value), trimmed);
  };
  const matchesSearch = (r: Row, q = search) => {
    const s = norm(q);
    if (!s) return true;
    const hay = [r.name, r.title, r.company, r.location].map(norm).join(" | ");
    return includesI(hay, s);
  };

  async function refreshWallet() {
    try {
      const res = await fetch("/api/wallet", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      setWallet(typeof data?.balance === "number" ? data.balance : 0);
    } catch {
      // ignore
    }
  }

  async function load() {
    setLoading(true);
    setErrorMsg(null);
    try {
      // cache: "no-store" — without this, the browser may serve a stale
      // cached response after the user adds a contact, so the new row
      // never appears in the table until a hard refresh.
      const res = await fetch("/api/contacts", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load contacts");
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      // The API caps how many rows it returns, so the real total comes back
      // as its own field rather than being counted from `data`.
      setTotalContacts(typeof json?.total === "number" ? json.total : data.length);
      const mapped: Row[] = data.map((c: any) => ({
        id: c.id,
        name: c.name ?? "",
        title: c.title ?? "",
        company: c.company ?? "",
        email: c.email ?? null,
        phone: c.phone ?? null,
        location: c.location ?? null,
        // Fields extracted from contacts.meta JSON by the API.
        department: c.department ?? null,
        notes: c.notes ?? null,
        country: c.country ?? null,
        segment: c.segment ?? null,
        company_type: c.company_type ?? null,
        created_at: c.created_at ?? null,
        linkedin_url: c.linkedin_url ?? null,
        facebook_url: c.facebook_url ?? null,
        instagram_url: c.instagram_url ?? null,
        // The API has always returned this, but the mapping used to drop it —
        // so every row arrived undefined, the Type badge read "Normal" for
        // everyone regardless of the tick, and the "leads" counter matched the
        // whole table. Normalized to exactly 'lead' | 'normal' so the badge,
        // the counter and the Contact type filter all agree.
        contact_type: c.contact_type === "lead" ? "lead" : "normal",
        is_unlocked: !!c.is_unlocked,
      }));
      setAllRows(mapped);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load contacts");
      setAllRows([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await refreshWallet();
      await load();
      try {
        const row = await getMySender();
        setMySender(row);
        if (row?.email) setFromEmail(row.email);
        if (row?.status) setVerStatus(row.status as any);
      } catch {}
    })();
  }, []);

  // Refresh the contacts list on tab return — fixes the "I added contacts
  // in another tab and don't see them here" complaint. Same pattern as
  // companies list and campaigns list.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        load();
      }
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Auto-poll SES while the sender is pending — handles "user verified in
  // another tab" without making them click Check status.
  useEffect(() => {
    if (isVerified) return;
    if (!fromEmail && !identityId) return;

    let cancelled = false;
    async function silentPoll() {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      try {
        const args = identityId ? { identityId } : { email: fromEmail };
        const resp = await checkEmailStatus(args);
        if (cancelled) return;
        setVerStatus(resp.status);
        if (resp.status === "verified") {
          const fresh = await getMySender();
          if (!cancelled && fresh) setMySender(fresh);
          if (!cancelled) setBanner({ kind: "success", msg: "Sender verified!" });
        }
      } catch { /* silent — periodic poll */ }
    }
    silentPoll();
    const id = setInterval(silentPoll, 4000);
    function onFocus() { silentPoll(); }
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [isVerified, fromEmail, identityId]);

  // derived options
  const TITLE_TOP_N = 8;
  const popularTitleSet = useMemo(() => {
    const count = new Map<string, number>();
    allRows.forEach((r) => {
      const t = norm(r.title);
      if (!t) return;
      count.set(t, (count.get(t) ?? 0) + 1);
    });
    return new Set(
      Array.from(count.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TITLE_TOP_N)
        .map(([t]) => t)
    );
  }, [allRows]);

  // Multi-select: empty array = no constraint, otherwise match any chosen value.
  // Compared case-insensitively: MySQL treats "Manufacturer" and "manufacturer"
  // as one value, and the filter has to agree or half the rows go missing.
  const anyOf = (chosen: string[], value: string | null | undefined) =>
    chosen.length === 0 ||
    chosen.some((c) => norm(c).toLowerCase() === norm(value ?? "").toLowerCase());

  // Title carries the synthetic "Others" bucket (everything outside the top N),
  // which can be combined with named titles: "Sales Manager" OR "Others".
  const titleMatches = (chosen: string[], value: string | null | undefined) => {
    if (chosen.length === 0) return true;
    const t = norm(value);
    return chosen.some((c) =>
      c === "Others" ? !popularTitleSet.has(t) : norm(c) === t
    );
  };

  const companyOptions = useMemo(() => {
    const base = allRows.filter((r) => {
      const titlePass = titleMatches(filters.title, r.title);
      const statusPass =
        filters.status === "all"
          ? true
          : filters.status === "locked"
          ? !r.is_unlocked
          : r.is_unlocked;
      return matchesSearch(r) && titlePass && statusPass;
    });
    return Array.from(
      new Set(base.map((r) => norm(r.company)).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [allRows, filters.title, filters.status, search, popularTitleSet]);

  const titleOptions = useMemo(() => {
    const base = allRows.filter((r) => {
      const companyPass = anyOf(filters.company, r.company);
      const statusPass =
        filters.status === "all"
          ? true
          : filters.status === "locked"
          ? !r.is_unlocked
          : r.is_unlocked;
      return matchesSearch(r) && companyPass && statusPass;
    });
    const titles = Array.from(
      new Set(base.map((r) => norm(r.title)).filter(Boolean))
    );
    const popular = titles
      .filter((t) => popularTitleSet.has(t))
      .sort((a, b) => a.localeCompare(b));
    const hasOthers =
      titles.some((t) => !popularTitleSet.has(t)) || titles.length === 0;
    return hasOthers ? [...popular, "Others"] : popular;
  }, [allRows, filters.company, filters.status, search, popularTitleSet]);

  // filter/sort/paginate
  useEffect(() => {
    let filtered = allRows.filter((r) => matchesSearch(r));
    filtered = filtered.filter(
      (r) =>
        anyOf(filters.company, r.company) &&
        titleMatches(filters.title, r.title) &&
        anyOf(filters.country, r.country) &&
        anyOf(filters.segment, r.segment) &&
        anyOf(filters.companyType, r.company_type)
    );
    if (filters.dateFrom || filters.dateTo) {
      const fromTs = filters.dateFrom
        ? new Date(`${filters.dateFrom}T00:00:00`).getTime()
        : null;
      const toTs = filters.dateTo
        ? new Date(`${filters.dateTo}T23:59:59.999`).getTime()
        : null;
      filtered = filtered.filter((r) => {
        const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
        if (Number.isNaN(t)) return false;
        if (fromTs !== null && t < fromTs) return false;
        if (toTs !== null && t > toTs) return false;
        return true;
      });
    }
    if (filters.status === "locked")
      filtered = filtered.filter((r) => !r.is_unlocked);
    if (filters.status === "unlocked")
      filtered = filtered.filter((r) => r.is_unlocked);

    // Lead vs normal. contact_type is normalized to exactly one of the two at
    // load, so this matches the Type badge and the counter exactly.
    if (filters.kind === "lead")
      filtered = filtered.filter((r) => r.contact_type === "lead");
    if (filters.kind === "normal")
      filtered = filtered.filter((r) => r.contact_type !== "lead");

    // Per-column header filters. matchColumnFilter handles both the "-" empty
    // shortcut and normal contains matching. Columns mirror the CSV template:
    //   company_id, contact_name, title, email, phone, linkedin_url
    if (columnFilters.name.trim())
      filtered = filtered.filter((r) => matchColumnFilter(r.name, columnFilters.name));
    if (columnFilters.email.trim())
      filtered = filtered.filter((r) => matchColumnFilter(r.email, columnFilters.email));
    if (columnFilters.title.trim())
      filtered = filtered.filter((r) => matchColumnFilter(r.title, columnFilters.title));
    if (columnFilters.company.trim())
      filtered = filtered.filter((r) => matchColumnFilter(r.company, columnFilters.company));
    if (columnFilters.phone.trim())
      filtered = filtered.filter((r) => matchColumnFilter(r.phone, columnFilters.phone));
    if (columnFilters.linkedin_url.trim())
      filtered = filtered.filter((r) => matchColumnFilter(r.linkedin_url, columnFilters.linkedin_url));

    filtered.sort((a, b) => {
      const av = norm(a[sortKey]).toLowerCase();
      const bv = norm(b[sortKey]).toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    setRows(filtered);
    setPage(1);
  }, [allRows, search, filters, columnFilters, sortKey, sortDir, popularTitleSet]);

  /**
   * Distinct, sorted, and deduplicated case-insensitively so one real-world
   * value can't appear twice under two spellings.
   *
   * `approved` is the controlled list for the column (see lib/vocab.ts). When
   * it has entries, anything not on it is left out — a misspelling that arrived
   * in a spreadsheet is not a filter option. An empty list means the
   * vocabulary isn't configured, so everything is offered as before.
   */
  const optionsFrom = (values: (string | null | undefined)[], approved: string[]) => {
    const seen = new Map<string, string>();
    for (const v of values) {
      const s = norm(v ?? "");
      if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
    }
    let out = Array.from(seen.values());
    if (approved.length) {
      const ok = new Set(approved.map((t) => t.toLowerCase()));
      out = out.filter((o) => ok.has(o.toLowerCase()));
    }
    return out.sort((a, b) => a.localeCompare(b));
  };

  // Approved values for the columns that feed dropdowns. Segments keep their
  // own endpoint because the Add/Edit forms write to it.
  const [segmentOptions, setSegmentOptions] = useState<string[]>([]);
  const [approvedTypes, setApprovedTypes] = useState<string[]>([]);
  const [approvedCountries, setApprovedCountries] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/companies/segments", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setSegmentOptions(Array.isArray(json?.segments) ? json.segments : []);
      } catch { setSegmentOptions([]); }
      try {
        const res = await fetch("/api/companies/vocab", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setApprovedTypes(Array.isArray(json?.terms?.company_type) ? json.terms.company_type : []);
        setApprovedCountries(Array.isArray(json?.terms?.country) ? json.terms.country : []);
      } catch {
        setApprovedTypes([]);
        setApprovedCountries([]);
      }
    })();
  }, []);

  const countryOptions = useMemo(
    () => optionsFrom(allRows.map((r) => r.country), approvedCountries),
    [allRows, approvedCountries]
  );

  const segmentFilterOptions = useMemo(
    () => optionsFrom(allRows.map((r) => r.segment), segmentOptions),
    [segmentOptions, allRows]
  );

  // Company Type comes from the joined company record.
  const companyTypeOptions = useMemo(
    () => optionsFrom(allRows.map((r) => r.company_type), approvedTypes),
    [allRows, approvedTypes]
  );

  const clearFilters = () => {
    setSearch("");
    setFilters({
      title: [],
      company: [],
      status: "all",
      kind: "all",
      country: [],
      segment: [],
      companyType: [],
      dateFrom: "",
      dateTo: "",
    });
    setColumnFilters({ name: "", email: "", title: "", company: "", phone: "", linkedin_url: "" });
    setSortKey("name");
    setSortDir("asc");
  };

  /** Are any filters narrowing the table right now? Drives the Export label. */
  const filtersActive =
    !!search.trim() ||
    filters.title.length > 0 ||
    filters.company.length > 0 ||
    filters.country.length > 0 ||
    filters.segment.length > 0 ||
    filters.companyType.length > 0 ||
    filters.status !== "all" ||
    filters.kind !== "all" ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    Object.values(columnFilters).some((v) => v.trim());

  /**
   * The current filter set, encoded for /api/contacts/export.
   *
   * The export runs the same filters in SQL rather than exporting the rows the
   * browser happens to hold, so a filtered download covers every matching
   * contact — not just the first page the list API returned.
   */
  const exportFilterParams = () => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("q", search.trim());
    filters.title.forEach((t) => p.append("title", t));
    if (filters.title.includes("Others")) {
      // "Others" is a client-side bucket: everything outside the top-N titles.
      // Send that list so the server can express it as NOT IN (...).
      p.set("titleOthers", "1");
      popularTitleSet.forEach((t) => p.append("notTitle", t));
    }
    filters.company.forEach((c) => p.append("company", c));
    filters.country.forEach((c) => p.append("country", c));
    filters.segment.forEach((s) => p.append("segment", s));
    filters.companyType.forEach((t) => p.append("type", t));
    if (filters.dateFrom) p.set("from", filters.dateFrom);
    if (filters.dateTo) p.set("to", filters.dateTo);
    if (filters.status !== "all") p.set("status", filters.status);
    if (filters.kind !== "all") p.set("kind", filters.kind);
    const cf: [string, string][] = [
      ["cf_name", columnFilters.name],
      ["cf_email", columnFilters.email],
      ["cf_title", columnFilters.title],
      ["cf_company", columnFilters.company],
      ["cf_phone", columnFilters.phone],
      ["cf_linkedin_url", columnFilters.linkedin_url],
    ];
    for (const [k, v] of cf) if (v.trim()) p.set(k, v.trim());
    return p;
  };

  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      // POST, not a plain link: the Company/Title selections can run to
      // hundreds of values, which would overflow a GET query string.
      const res = await fetch("/api/contacts/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: exportFilterParams().toString(),
      });
      if (!res.ok) throw new Error((await res.text()) || "Export failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — revoking synchronously can cancel the
      // download in some browsers before it has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e: any) {
      toast({
        title: "Export failed",
        description: e?.message || "Could not build the CSV",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  // counts
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => setPage(1), [pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);
  const currentRows = useMemo(
    () => rows.slice(startIdx, endIdx),
    [rows, startIdx, endIdx]
  );

  const lockedVisible = rows.filter((r) => !r.is_unlocked).length;
  const unlockedVisible = rows.filter((r) => r.is_unlocked).length;

  /* ─────────────────────── unlock actions ─────────────────────── */

  const lockedIdsOnFilter = useMemo(
    () => rows.filter((r) => !r.is_unlocked).map((r) => r.id),
    [rows]
  );
  const lockedCount = lockedIdsOnFilter.length;
  const bulkTotal = lockedCount * 5;

  async function unlockContact(id: string) {
    try {
      // fresh wallet
      await refreshWallet();
      if ((wallet ?? 0) < 5) {
        alert(
          "Insufficient credit balance. Please add credits to unlock this contact."
        );
        return;
      }
      setUnlockingId(id);

      const res = await fetch("/api/contacts/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ contact_id: id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) alert("Please sign in and try again.");
        else if (res.status === 402) alert("Insufficient credits.");
        else alert(j?.error || "Unlock failed");
        return;
      }
      await load();
      await refreshWallet();
    } finally {
      setUnlockingId(null);
      setConfirmUnlockId(null);
    }
  }

  async function openBulkDialog() {
    await refreshWallet();
    setShowBulk(true);
  }

  async function doBulkUnlock() {
    try {
      setBulkBusy(true);
      const res = await fetch("/api/contacts/unlock-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ contact_ids: lockedIdsOnFilter }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          alert("Please sign in and try again.");
        } else if (res.status === 402 || j?.insufficient_credits || j?.status === "INSUFFICIENT_CREDITS") {
          alert("Your credits are not enough to unlock all selected contacts.");
        } else {
          alert(j?.error || "Bulk unlock failed");
        }
        return;
      }
      setShowBulk(false);
      await load();
      await refreshWallet();
    } finally {
      setBulkBusy(false);
    }
  }

  /* ───────────────────── one-off email flow ───────────────────── */

  function launchSend(r: Row) {
    if (!r.email) {
      setBanner({ kind: "warn", msg: "This contact does not have an email." });
      return;
    }
    const c: ContactRow = {
      contact_id: r.id,
      contact_name: r.name || null,
      email: r.email,
    };
    setTarget(c);
    setSubject("");
    setHtml("");
    setOpenSend(true);
  }

  async function handleStartVerify() {
    if (!fromEmail) return;
    const current = mySender?.email?.trim().toLowerCase();
    const next = fromEmail.trim().toLowerCase();
    const isNew = !current || current !== next;
    if (isNew && left === 0) {
      setBanner({ kind: "error", msg: "Change limit reached (2/2)." });
      return;
    }
    if (mySender && isNew) {
      if (!confirm(`Replace ${mySender.email} → ${fromEmail}?`)) return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const resp = await startEmailVerify(fromEmail);
      setIdentityId(resp?.id ?? null);
      setVerStatus("pending");
      setBanner({
        kind: "success",
        msg: "Verification email sent. Check your inbox.",
      });
    } catch (e: any) {
      setVerStatus("error");
      setBanner({
        kind: "error",
        msg: e?.message || "Could not start verification.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function pollVerification() {
    if (!fromEmail && !identityId) return;
    setBusy(true);
    try {
      const args = identityId ? { identityId } : { email: fromEmail };
      const resp = await checkEmailStatus(args);
      setVerStatus(resp.status);
      if (resp.status === "verified")
        setBanner({ kind: "success", msg: "Sender verified!" });
      else if (resp.status === "pending")
        setBanner({ kind: "info", msg: "Still pending." });
      else if (resp.status === "failed")
        setBanner({ kind: "error", msg: "Verification failed." });
    } catch {
      setBanner({ kind: "error", msg: "Could not fetch status." });
    } finally {
      setBusy(false);
    }
  }

  function pasteTemplate() {
    setSubject("Quick check-in ✉️");
    setHtml(`<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;">
      <h2 style="margin:0 0 8px 0;">Hi ${target?.contact_name || "there"},</h2>
      <p>Testing one-off email flow. Please click the link for tracking.</p>
      <p><a href="https://example.com/hello?utm_source=oneoff">Click here</a> to trigger a click event.</p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">This is a test email.</p>
    </body></html>`);
  }

  async function sendOneoff() {
    if (!target) return;
    if (!isVerified) {
      const go = confirm("No verified sender. Go to Campaigns to verify?");
      if (go) window.location.href = "/campaigns";
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch("/api/email/oneoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          to: target.email,
          subject,
          html,
          from_email: fromEmail || mySender?.email,
          contact_id: target.contact_id,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || j?.error || "Send failed");
      setBanner({
        kind: "success",
        msg: "Email sent! Tracking will update shortly.",
      });
      setOpenSend(false);
      await openTracking(target);
    } catch (e: any) {
      setBanner({ kind: "error", msg: e?.message || "Send failed" });
    } finally {
      setBusy(false);
    }
  }

  async function openTracking(c: ContactRow) {
    setTarget(c);
    setOpenTrack(true);
    await loadTracking(c);
  }

  async function loadTracking(c: ContactRow) {
    setTrackLoading(true);
    try {
      const res = await fetch(
        `/api/email/oneoff/tracking?email=${encodeURIComponent(c.email)}`,
        { credentials: "same-origin" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to load tracking");
      setTrackRows(Array.isArray(j?.rows) ? j.rows : []);
    } catch (e: any) {
      setBanner({
        kind: "error",
        msg: e?.message || "Failed to load tracking",
      });
    } finally {
      setTrackLoading(false);
    }
  }

  const fmtDate = (x: string | null) => {
    if (!x) return "—";
    try {
      const d = new Date(x);
      return d.toLocaleString(undefined, {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return x as any;
    }
  };

  /* ─────────────────────────── UI ─────────────────────────── */

  const SocialCell = ({ r }: { r: Row }) => {
    const linkCls =
      "inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-700 transition-colors";
    const disabledCls =
      "inline-flex items-center justify-center w-8 h-8 rounded-md opacity-40 cursor-not-allowed";
    const Wrap = ({ children }: any) => (
      <div className="flex items-center gap-1">{children}</div>
    );
    if (!r.is_unlocked) {
      return (
        <Wrap>
          <span className={disabledCls} title="Unlock to view">
            <Linkedin className="w-4 h-4" />
          </span>
          <span className={disabledCls} title="Unlock to view">
            <Facebook className="w-4 h-4" />
          </span>
          <span className={disabledCls} title="Unlock to view">
            <Instagram className="w-4 h-4" />
          </span>
        </Wrap>
      );
    }
    return (
      <Wrap>
        {r.linkedin_url ? (
          <a
            href={r.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkCls}
          >
            <Linkedin className="w-4 h-4" />
          </a>
        ) : // <span className={disabledCls}>
        //   <Linkedin className="w-4 h-4" />
        // </span>
        null}
        {r.facebook_url ? (
          <a
            href={r.facebook_url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkCls}
          >
            <Facebook className="w-4 h-4" />
          </a>
        ) : // <span className={disabledCls}>
        //   <Facebook className="w-4 h-4" />
        // </span>
        null}
        {r.instagram_url ? (
          <a
            href={r.instagram_url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkCls}
          >
            <Instagram className="w-4 h-4" />
          </a>
        ) : // <span className={disabledCls}>
        //   <Instagram className="w-4 h-4" />
        // </span>
        null}
      </Wrap>
    );
  };

  const canAffordSingle = (wallet ?? 0) >= 5;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Contacts"
        description="Manage your contact database and track engagement"
      >
        {isAdmin && (
          <span className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-emerald-900/40 text-emerald-200 border border-emerald-700">
            <Shield className="w-3 h-3" /> Admin
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200">
          <Wallet className="w-4 h-4" />
          Credits: <b>{wallet ?? "…"}</b>
        </span>

        {/* Bulk import — staff (admin/moderator) only.
            Regular users use the "Add Contact" modal for one-row inserts. */}
        {isStaffUser && (
          <>
            <button
              onClick={() => {
                const cols = ["company_id", "contact_name", "title", "email", "phone", "linkedin_url", "facebook_url", "instagram_url"];
                const csv = cols.join(",") + "\n";
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "contacts_template.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium"
            >
              Template
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
              disabled={uploading}
            >
              <Upload className="w-4 h-4" />
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            setUploadResult(null);
            try {
              const fd = new FormData();
              fd.append("file", file);
              const res = await fetch("/api/contacts/import", {
                method: "POST",
                body: fd,
                credentials: "same-origin",
              });
              const { ok, json, message } = await readUploadResponse(res, file.size);
              if (ok) {
                setUploadResult(json);
                toast({
                  title: "Import complete",
                  description: `${json.inserted ?? 0} added · ${json.failed ?? 0} failed`,
                });
                await load();
              } else {
                setUploadResult(json ?? { inserted: 0, errors: [{ row: -1, error: message }] });
                toast({
                  variant: "destructive",
                  title: "Import failed",
                  description: message,
                });
              }
            } catch (err) {
              const detail = err instanceof Error ? err.message : "Could not contact the server.";
              setUploadResult({
                inserted: 0,
                errors: [{ row: -1, error: `Upload failed — ${detail}` }],
              });
            } finally {
              setUploading(false);
              if (fileRef.current) fileRef.current.value = "";
            }
          }}
        />
        <button
          onClick={exportCsv}
          disabled={exporting}
          title={
            filtersActive
              ? "Downloads only the contacts matching the filters above"
              : "Downloads every contact you can access"
          }
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
        >
          {exporting ? "Exporting…" : filtersActive ? "Export filtered" : "Export"}
        </button>
        <button
          onClick={() => {
            setShowAdd(true);
            (async () => {
              try {
                const res = await fetch("/api/companies?limit=100000", { credentials: "same-origin" });
                const j = await res.json().catch(() => ({}));
                const list = Array.isArray(j?.data) ? j.data : [];
                setCompanies(list.map((r: any) => ({ company_id: r.company_id, company_name: r.company_name || r.name || r.company_id })));
              } catch {
                setCompanies([]);
              }
            })();
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Add Contact
        </button>

        {/* Bulk Delete — admin only. Backend also rejects non-admin callers. */}
        {isAdmin && selectedIds.size > 0 && (
          <button
            onClick={() => setShowBulkDelete(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" /> Delete {selectedIds.size}
          </button>
        )}

        {/* Unlock All (filtered) — hidden for staff (no unlock flow) */}
        {!isStaffUser && (
          <button
            onClick={openBulkDialog}
            disabled={lockedCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            title={
              lockedCount === 0
                ? "No locked contacts in current filter"
                : "Unlock all locked contacts in current filter"
            }
          >
            <LockOpen className="w-4 h-4" /> Unlock All ({lockedCount})
          </button>
        )}
      </SectionHeader>

      {/* Totals + what the two contact types actually mean. The Lead/Normal
          distinction decides whether a contact is mailable in campaigns, which
          was previously only discoverable by hovering the table badge. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-white tabular-nums">
            {(totalContacts ?? allRows.length).toLocaleString()}
          </span>
          <span className="text-xs text-gray-400">contacts in total</span>
        </div>
        {/* Doubles as the shortcut into the Leads-only view — clicking the
            count is the obvious move, so make it do the obvious thing. */}
        <button
          type="button"
          onClick={() =>
            setFilters((f) => ({ ...f, kind: f.kind === "lead" ? "all" : "lead" }))
          }
          aria-pressed={filters.kind === "lead"}
          title={filters.kind === "lead" ? "Show all contacts again" : "Show lead contacts only"}
          className={`flex items-baseline gap-2 rounded-lg px-2 py-1 -mx-2 transition-colors ${
            filters.kind === "lead" ? "bg-emerald-900/30 ring-1 ring-emerald-700" : "hover:bg-gray-800"
          }`}
        >
          <span className="text-lg font-semibold text-emerald-400 tabular-nums">
            {allRows.filter((r) => r.contact_type === "lead").length.toLocaleString()}
          </span>
          <span className="text-xs text-gray-400">
            {filters.kind === "lead" ? "leads — showing only these" : "leads loaded · show only"}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400 md:ml-auto">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-emerald-600 bg-emerald-900/30 text-emerald-300 font-medium">
              Lead
            </span>
            mailable — included in lead-generation campaigns
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-600 bg-gray-800 text-gray-400 font-medium">
              Normal
            </span>
            CRM only — never bulk-emailed
          </span>
        </div>
      </div>

      {/* banner */}
      {banner && (
        <div
          className={`p-3 rounded border text-sm ${
            banner.kind === "success"
              ? "border-emerald-600 bg-emerald-900/20 text-emerald-200"
              : banner.kind === "error"
              ? "border-red-600 bg-red-900/20 text-red-200"
              : banner.kind === "warn"
              ? "border-amber-600 bg-amber-900/20 text-amber-200"
              : "border-sky-600 bg-sky-900/20 text-sky-200"
          }`}
        >
          {banner.msg}
        </div>
      )}

      {/* Bulk-import result panel — renders the per-row errors returned by
          /api/contacts/import so the operator can see which rows failed and
          why (duplicate email, unknown company, column too long, etc.). The
          panel was previously invisible: uploadResult was set on the import
          response but never rendered, so the client saw a "1 added · 49
          failed" toast with no explanation. */}
      {uploadResult && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">
                CSV import result
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Parsed <span className="text-white">{uploadResult.parsed ?? "—"}</span>
                {" · "}
                Added <span className="text-emerald-300">{uploadResult.inserted ?? 0}</span>
                {(uploadResult.skipped ?? 0) > 0 && (
                  <>
                    {" · "}
                    Skipped <span className="text-amber-300">{uploadResult.skipped}</span>
                    <span className="text-gray-500"> (duplicates)</span>
                  </>
                )}
                {(uploadResult.failed ?? 0) > 0 && (
                  <>
                    {" · "}
                    Failed <span className="text-rose-300">{uploadResult.failed}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUploadResult(null)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-700 hover:border-gray-600"
              aria-label="Dismiss import result"
            >
              Dismiss
            </button>
          </div>

          {/* Top-level error (e.g. "Missing required column") */}
          {uploadResult.error && (
            <div className="text-sm text-rose-300 border border-rose-700/50 bg-rose-900/20 rounded p-2">
              {uploadResult.error}
              {Array.isArray(uploadResult.detail) && uploadResult.detail.length > 0 && (
                <ul className="mt-1 list-disc list-inside text-xs text-rose-200/80">
                  {uploadResult.detail.map((d: string, i: number) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Per-row errors. CSV row numbers are 1-based, header is row 1,
              so row 2 = first data row. */}
          {Array.isArray(uploadResult.errors) && uploadResult.errors.length > 0 && (
            <div className="overflow-x-auto rounded border border-gray-800">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/60 text-gray-300">
                  <tr>
                    <th className="text-left px-3 py-1.5 w-24">CSV row</th>
                    <th className="text-left px-3 py-1.5">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {uploadResult.errors.map(
                    (e: { row: number; error: string }, i: number) => (
                      <tr key={i} className="hover:bg-gray-800/40">
                        <td className="px-3 py-1.5 font-mono text-gray-400">
                          {e.row > 0 ? e.row : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-rose-200">{e.error}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {uploadResult.errors.length >= 50 && (
                <div className="px-3 py-1.5 text-xs text-amber-300 bg-amber-950/30">
                  Showing the first 50 errors. There may be more — fix these and re-import to see the rest.
                </div>
              )}
            </div>
          )}

          {/* Helpful tips if any rows failed. Duplicate emails are now
              skipped silently (no failed count), so the tip set focuses on
              the errors the operator can actually act on. */}
          {(uploadResult.failed ?? 0) > 0 && (
            <div className="text-xs text-gray-400 leading-relaxed">
              <strong className="text-gray-300">Common fixes:</strong>{" "}
              "Invalid email format" — fix the typo or remove the email value.{" "}
              "Company not found" — either create the company first, leave the column blank, or use the exact company name.{" "}
              "Data too long" — shorten the value (most string columns are capped at 255 chars).
            </div>
          )}
        </div>
      )}

      {/* Search + Filters + Sort */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
        <div className="grid md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label htmlFor="contacts-search" className="text-xs text-gray-400 block mb-1">Search</label>
            <div className="relative">
              <SearchIcon className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                id="contacts-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, title, company or location…"
                aria-label="Search contacts"
                className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <MultiSelectFilter
              id="contacts-title"
              label="Title"
              options={titleOptions}
              selected={filters.title}
              onChange={(next) => setFilters((f) => ({ ...f, title: next }))}
              placeholder="All titles"
              searchPlaceholder="Search titles…"
            />
          </div>

          <div className="md:col-span-3">
            <MultiSelectFilter
              id="contacts-company"
              label="Company"
              options={companyOptions}
              selected={filters.company}
              onChange={(next) => setFilters((f) => ({ ...f, company: next }))}
              placeholder="All companies"
              searchPlaceholder="Search companies…"
            />
          </div>

          {!isStaffUser && (
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1" htmlFor="contacts-status">
                Status
              </label>
              <select
                id="contacts-status"
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, status: e.target.value as any }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
              >
                <option value="all">All</option>
                <option value="locked">Locked</option>
                <option value="unlocked">Unlocked</option>
              </select>
            </div>
          )}

          {/* Lead vs normal — mirrors the "Lead contact" tick on the add/edit
              form, so a list built for campaigns can be viewed on its own. */}
          <div className={isStaffUser ? "md:col-span-3" : "md:col-span-2"}>
            <label className="text-xs text-gray-400 block mb-1" htmlFor="contacts-kind">
              Contact type
            </label>
            <select
              id="contacts-kind"
              value={filters.kind}
              onChange={(e) =>
                setFilters((f) => ({ ...f, kind: e.target.value as any }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            >
              <option value="all">All contacts</option>
              <option value="lead">Leads only</option>
              <option value="normal">Normal only</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <MultiSelectFilter
              id="contacts-country"
              label="Country"
              options={countryOptions}
              selected={filters.country}
              onChange={(next) => setFilters((f) => ({ ...f, country: next }))}
              placeholder="All countries"
              searchPlaceholder="Search countries…"
            />
          </div>

          <div className="md:col-span-3">
            <MultiSelectFilter
              id="contacts-segment"
              label="Segment"
              options={segmentFilterOptions}
              selected={filters.segment}
              onChange={(next) => setFilters((f) => ({ ...f, segment: next }))}
              placeholder="All segments"
              searchPlaceholder="Search segments…"
            />
          </div>

          <div className="md:col-span-3">
            <MultiSelectFilter
              id="contacts-company-type"
              label="Company Type"
              options={companyTypeOptions}
              selected={filters.companyType}
              onChange={(next) => setFilters((f) => ({ ...f, companyType: next }))}
              placeholder="All types"
              searchPlaceholder="Search types…"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-gray-400 block mb-1">Added from</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateFrom: e.target.value }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-gray-400 block mb-1">Added to</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateTo: e.target.value }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>

          <div className="md:col-span-12 flex flex-wrap items-end gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Sort by</label>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm"
              >
                <option value="name">Name</option>
                <option value="title">Title</option>
                <option value="company">Company</option>
                <option value="country">Country</option>
              </select>
              <button
                onClick={() =>
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                }
                className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm flex items-center gap-1"
                title={
                  sortDir === "asc" ? "Ascending (A→Z)" : "Descending (Z→A)"
                }
              >
                {sortDir === "asc" ? (
                  <SortAsc className="w-4 h-4" />
                ) : (
                  <SortDesc className="w-4 h-4" />
                )}
                {sortDir === "asc" ? "A→Z" : "Z→A"}
              </button>
            </div>

            <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
              {!isStaffUser && (
                <>
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {lockedVisible} locked
                  </span>
                  <span className="flex items-center gap-1">
                    <LockOpen className="w-3 h-3" /> {unlockedVisible} unlocked
                  </span>
                </>
              )}
              <button
                onClick={clearFilters}
                className="px-3 py-2 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg text-sm"
              >
                Clear
              </button>
              <span>
                Showing <b>{rows.length}</b> of <b>{allRows.length}</b>
              </span>
            </div>
          </div>
        </div>
      </div>

      {errorMsg ? (
        <div className="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-200">
          {errorMsg}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          description="Add your first contact, or import a CSV from your existing CRM."
          primary={{
            label: "Add Contact",
            onClick: () => {
              setShowAdd(true);
              (async () => {
                try {
                  const res = await fetch("/api/companies?limit=100000", { credentials: "same-origin" });
                  const j = await res.json().catch(() => ({}));
                  const list = Array.isArray(j?.data) ? j.data : [];
                  setCompanies(list.map((r: any) => ({ company_id: r.company_id, company_name: r.company_name || r.name || r.company_id })));
                } catch { setCompanies([]); }
              })();
            },
          }}
          secondary={isStaffUser ? { label: "Import CSV", onClick: () => fileRef.current?.click() } : undefined}
        />
      ) : (
        <>
          <Table
            maxHeight="70vh"
            headers={headers}
            data={currentRows.map((r) => ({
              ...(isAdmin
                ? {
                    Select: (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${r.name}`}
                      />
                    ),
                  }
                : {}),
              name: (
                <div className="flex flex-col">
                  <span className="font-medium">{r.name}</span>
                </div>
              ),
              email: r.is_unlocked ? (
                r.email || "—"
              ) : (
                <span className="text-gray-400">••••••••••</span>
              ),
              title: r.title || "—",
              company: r.company || "—",
              phone: r.is_unlocked ? (
                r.phone || "—"
              ) : (
                <span className="text-gray-400">••••••••••</span>
              ),
              // Mirrors the CSV template's linkedin_url column. Renders as a
              // clickable link when present and respects the locked-state mask.
              linkedin_url: r.is_unlocked ? (
                (() => {
                  const li = externalUrl(r.linkedin_url);
                  const web = externalUrl((r as any).website);
                  if (!li && !web) return "—";
                  return (
                    <div className="flex flex-col gap-1 max-w-[220px]">
                      {li && (
                        <a
                          href={li}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 truncate text-emerald-300 hover:underline"
                          title={r.linkedin_url ?? undefined}
                        >
                          <Linkedin className="w-3.5 h-3.5 shrink-0" /> LinkedIn
                        </a>
                      )}
                      {web && (
                        <a
                          href={web}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 truncate text-sky-300 hover:underline"
                          title={(r as any).website}
                        >
                          <Globe className="w-3.5 h-3.5 shrink-0" /> Website
                        </a>
                      )}
                    </div>
                  );
                })()
              ) : (
                <span className="text-gray-400">••••••••••</span>
              ),
              type: (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                    r.contact_type === "lead"
                      ? "border-emerald-600 bg-emerald-900/30 text-emerald-300"
                      : "border-gray-600 bg-gray-800 text-gray-400"
                  }`}
                  title={
                    r.contact_type === "lead"
                      ? "Included in lead-generation campaigns"
                      : "CRM only — excluded from bulk email"
                  }
                >
                  {r.contact_type === "lead" ? "Lead" : "Normal"}
                </span>
              ),
              Actions: r.is_unlocked ? (
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                  <div className="flex gap-2">
                    <button
                      onClick={() => launchSend(r)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-emerald-600 bg-emerald-700 hover:bg-emerald-600 text-white"
                      title="Send a one-off email"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Email
                    </button>
                    <button
                      onClick={() =>
                        openTracking({
                          contact_id: r.id,
                          contact_name: r.name || null,
                          email: r.email || "",
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                    <button
                      onClick={() => openEdit(r)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
                      title="Edit contact details"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmUnlockId(r.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap disabled:opacity-60"
                    title="Spend credits to reveal this contact's details"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Unlock
                  </button>
                  <button
                    onClick={() => openEdit(r)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
                    title="Edit contact details"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              ),
            }))}
          />

          {/* Pagination */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 py-4">
            <div className="text-sm text-gray-400">
              Showing <b>{rows.length === 0 ? 0 : startIdx + 1}</b>–
              <b>{endIdx}</b> of <b>{rows.length}</b>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-gray-300">
                Rows per page:{" "}
                <select
                  className="ml-2 bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm"
                  value={pageSize}
                  onChange={(e) =>
                    setPageSize(Number(e.target.value) as 15 | 30 | 50)
                  }
                >
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-sm disabled:opacity-50"
                >
                  « First
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-sm disabled:opacity-50"
                >
                  ‹ Prev
                </button>
                {Array.from({
                  length: Math.min(7, Math.max(1, totalPages)),
                }).map((_, i) => {
                  const n = i + Math.max(1, Math.min(page - 3, totalPages - 6));
                  return (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`px-2 py-1 rounded-md border text-sm ${
                        n === page
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-sm disabled:opacity-50"
                >
                  Next ›
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-sm disabled:opacity-50"
                >
                  Last »
                </button>
              </div>
              <div className="text-sm text-gray-400">
                Page <b>{page}</b> of <b>{totalPages}</b>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Confirm Unlock Modal */}
      {confirmUnlockId && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-5">
            <h3 className="text-lg font-semibold text-white">Unlock contact</h3>
            {(wallet ?? 0) < 5 ? (
              <div className="text-sm text-amber-200 mt-2 space-y-2">
                You have <b>{wallet ?? 0}</b> credits. You need at least{" "}
                <b>5</b> to unlock this contact.
                <div className="flex items-center justify-end gap-2">
                  <a
                    href="/#pricing"
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                  >
                    Buy credits
                  </a>
                  <button
                    onClick={() => setConfirmUnlockId(null)}
                    className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm hover:border-gray-600"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-300 mt-2">
                  Spend <b>5 credits</b> to unlock this contact’s details. You
                  won’t be charged again for this contact.
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setConfirmUnlockId(null)}
                    className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm hover:border-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => unlockContact(confirmUnlockId)}
                    disabled={unlockingId === confirmUnlockId}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
                  >
                    {unlockingId === confirmUnlockId
                      ? "Unlocking…"
                      : "Unlock • 5 credits"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bulk Delete Confirm Modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6">
            <h3 className="text-lg font-semibold text-white">
              Delete {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"}?
            </h3>
            <p className="mt-2 text-sm text-gray-300">
              This is permanent. Associated unlock records will also be removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowBulkDelete(false)}
                className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm"
                disabled={bulkDeleteBusy}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setBulkDeleteBusy(true);
                  try {
                    const ids = Array.from(selectedIds);
                    const res = await fetch("/api/contacts/bulk-delete", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify({ ids }),
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(j?.error || "Delete failed");
                    toast({
                      title: "Contacts deleted",
                      description: `${j.deleted ?? 0} removed${j.skipped ? ` · ${j.skipped} skipped` : ""}`,
                    });
                    setSelectedIds(new Set());
                    setShowBulkDelete(false);
                    await load();
                  } catch (e: any) {
                    toast({
                      variant: "destructive",
                      title: "Delete failed",
                      description: e?.message || "Could not delete",
                    });
                  } finally {
                    setBulkDeleteBusy(false);
                  }
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60"
                disabled={bulkDeleteBusy}
              >
                {bulkDeleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Unlock Modal */}
      {showBulk && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-5">
            <h3 className="text-lg font-semibold text-white">
              Unlock all filtered contacts
            </h3>
            <div className="text-sm text-gray-300 mt-2 space-y-1">
              <div>
                Locked contacts in current filter: <b>{lockedCount}</b>
              </div>
              <div>
                Price: <b>{lockedCount}</b> × <b>5</b> = <b>{bulkTotal}</b>{" "}
                credits
              </div>
              <div>
                Your credits: <b>{wallet ?? "…"}</b>
              </div>
              {(wallet ?? 0) < bulkTotal && (
                <div className="mt-1 inline-flex items-center gap-2 text-amber-300">
                  <ShieldAlert className="w-4 h-4" /> Your credits are not
                  enough to unlock all contacts.
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {(wallet ?? 0) < bulkTotal && (
                <a
                  href="/"
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                >
                  Buy credits
                </a>
              )}
              <button
                onClick={() => setShowBulk(false)}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={doBulkUnlock}
                disabled={
                  bulkBusy || (wallet ?? 0) < bulkTotal || lockedCount === 0
                }
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
              >
                {bulkBusy ? "Purchasing…" : `Unlock ${lockedCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Contact Modal (Admin only) */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900">
            <div className="px-5 pt-5 pb-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Add Contact</h3>
              {addErr && <div className="text-sm text-red-300">{addErr}</div>}
            </div>

            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
              {isStaffUser && (
                <CardScanButton
                  onExtract={(data: ScanExtracted) => {
                    const c = data.contact ?? {};
                    // Only fill empty fields so a partial re-scan doesn't clobber typed input.
                    setForm((prev) => ({
                      ...prev,
                      contact_name: prev.contact_name || (c.contact_name ?? ""),
                      title:        prev.title        || (c.title ?? ""),
                      email:        prev.email        || (c.email ?? ""),
                      phone:        prev.phone        || (c.phone ?? ""),
                      linkedin_url: prev.linkedin_url || (c.linkedin_url ?? ""),
                    }));
                  }}
                />
              )}

              <div className="grid md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
                  <label className="text-xs text-gray-400 block mb-1">
                    Company
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={form.company_id}
                      onChange={(e) =>
                        setForm({ ...form, company_id: e.target.value })
                      }
                      className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    >
                      <option value="">Select company…</option>
                      {companies.map((c) => (
                        <option key={c.company_id} value={c.company_id}>
                          {c.company_name} ({c.company_id})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setNewCompanyOpen((v) => !v);
                        setNewCompanyErr(null);
                      }}
                      className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm whitespace-nowrap"
                      title="Don't see your company? Create a new one here."
                    >
                      + New
                    </button>
                  </div>

                  {/* Inline "Create company" form — appears only when the
                      user clicked + New.  Posts to /api/companies, refreshes
                      the local companies list, and auto-selects the new row. */}
                  {newCompanyOpen && (
                    <div className="mt-2 p-3 rounded-lg border border-emerald-700/50 bg-emerald-950/20 space-y-2">
                      <div className="text-xs text-emerald-200 font-medium">
                        Create a new company
                      </div>
                      {newCompanyErr && (
                        <div className="text-xs text-red-300 border border-red-700/50 bg-red-950/40 rounded p-2">
                          {newCompanyErr}
                        </div>
                      )}
                      <div className="grid md:grid-cols-3 gap-2">
                        <input
                          type="text"
                          placeholder="Company name *"
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                        />
                        <input
                          type="text"
                          placeholder="Code (optional — auto-generated)"
                          value={newCompanyCode}
                          onChange={(e) => setNewCompanyCode(e.target.value)}
                          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                        />
                        <input
                          type="text"
                          placeholder="Country (optional)"
                          value={newCompanyCountry}
                          onChange={(e) => setNewCompanyCountry(e.target.value)}
                          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setNewCompanyOpen(false);
                            setNewCompanyName("");
                            setNewCompanyCode("");
                            setNewCompanyCountry("");
                            setNewCompanyErr(null);
                          }}
                          className="px-3 py-1.5 text-xs rounded border border-gray-700 bg-gray-800 text-gray-200"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={newCompanyBusy || !newCompanyName.trim()}
                          onClick={async () => {
                            setNewCompanyBusy(true);
                            setNewCompanyErr(null);
                            try {
                              const res = await fetch("/api/companies", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                credentials: "same-origin",
                                body: JSON.stringify({
                                  name: newCompanyName.trim(),
                                  code: newCompanyCode.trim() || undefined,
                                  country: newCompanyCountry.trim() || null,
                                }),
                              });
                              const j = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(j?.error || "Failed to create company");
                              const created = j?.company;
                              if (!created?.company_id) throw new Error("No company id returned");
                              // Refresh companies list, then auto-select the new one.
                              const listRes = await fetch("/api/companies?limit=100000", {
                                credentials: "same-origin",
                              });
                              const listJ = await listRes.json().catch(() => ({}));
                              const list = Array.isArray(listJ?.data) ? listJ.data : [];
                              setCompanies(
                                list.map((c: any) => ({
                                  company_id: c.company_id,
                                  company_name: c.company_name || c.name || c.company_id,
                                }))
                              );
                              setForm({ ...form, company_id: created.company_id });
                              setNewCompanyOpen(false);
                              setNewCompanyName("");
                              setNewCompanyCode("");
                              setNewCompanyCountry("");
                              toast({
                                title: "Company created",
                                description: `${created.company_name || created.company_id} is now selected.`,
                              });
                            } catch (e: any) {
                              setNewCompanyErr(e?.message || "Failed to create");
                            } finally {
                              setNewCompanyBusy(false);
                            }
                          }}
                          className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                        >
                          {newCompanyBusy ? "Creating…" : "Create + select"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="md:col-span-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.contact_type === "lead"}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          contact_type: e.target.checked ? "lead" : "normal",
                        })
                      }
                      className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span>
                      <span className="text-sm text-gray-200 block">
                        Lead contact — include in lead-generation mails
                      </span>
                      <span className="text-[11px] text-gray-500 block mt-0.5">
                        Tick for a lead you want to email in campaigns. Leave it unticked
                        for a normal CRM contact — stored, but never bulk-mailed.
                      </span>
                    </span>
                  </label>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Name
                  </label>
                  <input
                    value={form.contact_name}
                    onChange={(e) =>
                      setForm({ ...form, contact_name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Title
                  </label>
                  <input
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    placeholder="Head of Marketing"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Department
                  </label>
                  <input
                    value={form.department}
                    onChange={(e) =>
                      setForm({ ...form, department: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    placeholder="Marketing"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Email
                  </label>
                  <input
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    placeholder="jane@company.com"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Phone
                  </label>
                  <PhoneInput
                    value={form.phone}
                    onChange={(next) => setForm({ ...form, phone: next })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Location
                  </label>
                  <input
                    value={form.location}
                    onChange={(e) =>
                      setForm({ ...form, location: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    placeholder="City, Country"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-xs text-gray-400 block mb-1">
                    Notes
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    LinkedIn URL
                  </label>
                  <input
                    value={form.linkedin_url}
                    onChange={(e) =>
                      setForm({ ...form, linkedin_url: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Facebook URL
                  </label>
                  <input
                    value={form.facebook_url}
                    onChange={(e) =>
                      setForm({ ...form, facebook_url: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Instagram URL
                  </label>
                  <input
                    value={form.instagram_url}
                    onChange={(e) =>
                      setForm({ ...form, instagram_url: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowAdd(false);
                  setAddErr(null);
                  setForm({
                    company_id: "",
                    contact_type: "lead",
                    contact_name: "",
                    title: "",
                    department: "",
                    email: "",
                    phone: "",
                    location: "",
                    notes: "",
                    linkedin_url: "",
                    facebook_url: "",
                    instagram_url: "",
                  });
                }}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    setAddBusy(true);
                    setAddErr(null);
                    if (!form.company_id || !form.contact_name)
                      throw new Error("Company and Name are required");
                    const payload: any = {
                      company_id: form.company_id,
                      contact_type: form.contact_type,
                      contact_name: form.contact_name,
                      title: form.title || null,
                      department: form.department || null,
                      email: form.email || null,
                      phone: form.phone || null,
                      location: form.location || null,
                      notes: form.notes || null,
                      linkedin_url: form.linkedin_url || null,
                      facebook_url: form.facebook_url || null,
                      instagram_url: form.instagram_url || null,
                    };
                    const insertRes = await fetch("/api/contacts", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify(payload),
                    });
                    const insertJ = await insertRes.json().catch(() => ({}));
                    if (!insertRes.ok) throw new Error(insertJ?.error || "Insert failed");
                    toast({
                      title: "Contact added",
                      description: form.contact_name,
                    });
                    setShowAdd(false);
                    setForm({
                      company_id: "",
                      contact_type: "lead",
                      contact_name: "",
                      title: "",
                      department: "",
                      email: "",
                      phone: "",
                      location: "",
                      notes: "",
                      linkedin_url: "",
                      facebook_url: "",
                      instagram_url: "",
                    });
                    await load();
                  } catch (e: any) {
                    setAddErr(e?.message || "Failed to add contact");
                  } finally {
                    setAddBusy(false);
                  }
                }}
                disabled={addBusy}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
              >
                {addBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Contact Modal — owners can edit their own rows; staff can edit any.
          Backend PATCH /api/contacts/[id] enforces ownership. */}
      {editingId && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900">
            <div className="px-5 pt-5 pb-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Edit contact</h3>
              {editErr && <div className="text-sm text-red-300">{editErr}</div>}
            </div>
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Company</label>
                <select
                  value={editForm.company_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, company_id: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                >
                  <option value="">— keep current —</option>
                  {companies.map((c) => (
                    <option key={c.company_id} value={c.company_id}>
                      {c.company_name} ({c.company_id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.contact_type === "lead"}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        contact_type: e.target.checked ? "lead" : "normal",
                      }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="text-sm text-gray-200 block">
                      Lead contact — include in lead-generation mails
                    </span>
                    <span className="text-[11px] text-gray-500 block mt-0.5">
                      Untick to make this a normal CRM contact — stored, but never
                      bulk-mailed.
                    </span>
                  </span>
                </label>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Name</label>
                <input
                  value={editForm.contact_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, contact_name: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Title</label>
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Phone</label>
                <PhoneInput
                  value={editForm.phone}
                  onChange={(next) => setEditForm((f) => ({ ...f, phone: next }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">LinkedIn URL</label>
                <input
                  value={editForm.linkedin_url}
                  onChange={(e) => setEditForm((f) => ({ ...f, linkedin_url: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-end gap-2">
              <button
                onClick={() => { setEditingId(null); setEditErr(null); }}
                disabled={editBusy}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editBusy || !editForm.contact_name.trim()}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
              >
                {editBusy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Modal */}
      {openSend && target && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  Send email to {target.contact_name || target.email}
                </h2>
                <p className="text-xs text-gray-400">{target.email}</p>
              </div>
              <button
                onClick={() => setOpenSend(false)}
                className="p-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Sender */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-white font-medium">Sender</h3>
                  {isVerified && (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  )}
                </div>

                {!isVerified ? (
                  <div className="rounded-lg border border-amber-600 bg-amber-900/10 p-4">
                    <p className="text-sm text-amber-200 mb-3">
                      You need a verified sender. Verify below or{" "}
                      <a href="/campaigns" className="underline">
                        verify on Campaigns
                      </a>
                      .
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Sender email
                        </label>
                        <input
                          type="email"
                          value={fromEmail}
                          onChange={(e) => setFromEmail(e.target.value)}
                          placeholder="you@company.com"
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300"
                        />
                        {mySender && (
                          <p className="text-[11px] text-gray-400 mt-1">
                            Changes left: <b>{left}</b> / 2
                          </p>
                        )}
                      </div>
                      <button
                        disabled={!fromEmail || busy}
                        onClick={handleStartVerify}
                        className="h-[42px] px-4 md:px-6 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 border border-emerald-500 rounded-lg text-white"
                      >
                        {busy ? "Working…" : "Verify"}
                      </button>
                      <button
                        disabled={busy || verStatus === "idle"}
                        onClick={pollVerification}
                        className="h-[42px] px-4 md:px-6 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 border border-gray-700 rounded-lg text-gray-200"
                      >
                        <RefreshCcw className="w-4 h-4 inline mr-1" /> Check
                        status
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-700 p-3 bg-gray-900/40">
                    <p className="text-sm text-gray-300">
                      From:{" "}
                      <b className="text-white">
                        {fromEmail || mySender?.email}
                      </b>{" "}
                      <span className="text-xs text-gray-500">(verified)</span>
                    </p>
                  </div>
                )}
              </section>

              {/* Compose */}
              <section className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-300">
                      HTML Content
                    </label>
                    <button
                      onClick={pasteTemplate}
                      className="text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      Use test template
                    </button>
                  </div>
                  <textarea
                    rows={8}
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    placeholder="Paste HTML here…"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 resize-none"
                  />
                </div>
              </section>
            </div>

            <div className="p-5 border-t border-gray-700 flex gap-3 justify-end">
              <button
                onClick={() => setOpenSend(false)}
                className="px-4 py-2 border border-gray-700 bg-gray-800 text-gray-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={sendOneoff}
                disabled={!isVerified || !subject || !html || busy}
                className={`px-4 py-2 rounded-lg ${
                  !isVerified || !subject || !html || busy
                    ? "bg-gray-700 text-gray-400"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                Send now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracking Modal */}
      {openTrack && target && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  Emails to {target.contact_name || target.email}
                </h2>
                <p className="text-xs text-gray-400">
                  One-off emails sent from Contacts
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadTracking(target)}
                  className="px-3 py-1.5 border border-gray-700 bg-gray-900 hover:bg-gray-700 text-gray-200 rounded-lg"
                >
                  <RefreshCcw className="w-3.5 h-3.5 inline mr-1" /> Refresh
                </button>
                <button
                  onClick={() => setOpenTrack(false)}
                  className="p-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-700"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[78vh]">
              <div className="overflow-auto rounded-xl border border-gray-700">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-gray-900/60">
                    <tr className="text-left text-gray-300">
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Sent</th>
                      <th className="px-3 py-2">Opened</th>
                      <th className="px-3 py-2">Clicks</th>
                      <th className="px-3 py-2">Last Event</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {trackLoading ? (
                      <tr>
                        <td className="px-3 py-3 text-gray-400" colSpan={8}>
                          Loading…
                        </td>
                      </tr>
                    ) : trackRows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-gray-400" colSpan={8}>
                          No one-off emails yet.
                        </td>
                      </tr>
                    ) : (
                      trackRows.map((r) => (
                        <tr key={r.id} className="text-gray-200">
                          <td
                            className="px-3 py-2 max-w-[280px] truncate"
                            title={r.subject}
                          >
                            {r.subject}
                          </td>
                          <td className="px-3 py-2 max-w-[260px] truncate text-gray-300">
                            {r.from_email}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${
                                r.status === "delivered"
                                  ? "bg-emerald-600/20 text-emerald-300"
                                  : r.status === "bounced" ||
                                    r.status === "complained"
                                  ? "bg-red-600/20 text-red-300"
                                  : r.status === "clicked"
                                  ? "bg-indigo-600/20 text-indigo-300"
                                  : r.status === "opened"
                                  ? "bg-sky-600/20 text-sky-300"
                                  : r.status === "sent"
                                  ? "bg-gray-600/20 text-gray-300"
                                  : "bg-gray-700/40 text-gray-300"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2">{fmtDate(r.sent_at)}</td>
                          <td className="px-3 py-2">
                            {r.opens_count > 0 ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 text-emerald-300">
                                  <Eye className="w-3.5 h-3.5" />{" "}
                                  {r.opens_count}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {fmtDate(r.opened_at)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {r.clicks_count > 0 ? (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 text-indigo-300">
                                  <MousePointerClick className="w-3.5 h-3.5" />{" "}
                                  {r.clicks_count}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {fmtDate(r.clicked_at)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {fmtDate(r.last_event_at)}
                          </td>
                          <td
                            className="px-3 py-2 text-red-300 max-w-[240px] truncate"
                            title={r.error || undefined}
                          >
                            {r.error || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-gray-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Opens require HTML + images on; clicks need absolute http(s)
                links.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
