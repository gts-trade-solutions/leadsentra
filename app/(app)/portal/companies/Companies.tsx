"use client";
export const dynamic = "force-dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import SectionHeader from "@/components/SectionHeader";
import Table from "@/components/Table";
import EmptyState from "@/components/EmptyState";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthProvider";
import { CardScanButton, type ScanExtracted } from "@/components/CardScanButton";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import PhoneInput from "@/components/PhoneInput";
import { externalUrl } from "@/lib/url";
import { readUploadResponse } from "@/lib/uploadError";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import DataReviewModal from "@/components/DataReviewModal";
import {
  Plus,
  Upload,
  AlertTriangle,
  RefreshCcw,
  Linkedin,
  Globe,
  Facebook,
  Instagram,
  Shield,
  Download,
  SortAsc,
  SortDesc,
  Lock,
  CheckCircle2,
  Pencil,
  Trash2,
} from "lucide-react";
// Supabase client removed during MySQL migration; auth/wallet now use /api/* routes.

type SizeBucket = "" | "lt100" | "lt1000" | "lt10000" | "gte10000";

export const SIZE_BUCKETS: { value: SizeBucket; label: string }[] = [
  { value: "", label: "All" },
  { value: "lt100", label: "< 100" },
  { value: "lt1000", label: "< 1,000" },
  { value: "lt10000", label: "< 10,000" },
  { value: "gte10000", label: "≥ 10,000" },
];

// Parse strings like "1–10", "11-50", "51 — 200", "10000+"
function sizeToRange(
  sizeStr?: string | null
): { min: number; max: number } | null {
  const s = (sizeStr || "").trim();
  if (!s) return null;

  const cleaned = s.replace(/[–—]/g, "-"); // normalize dashes
  const nums = cleaned.match(/\d+/g)?.map((n) => parseInt(n, 10)) ?? [];
  if (nums.length === 0) return null;

  if (nums.length === 1) {
    const n = nums[0];
    const plus = /\+$/.test(cleaned);
    return { min: n, max: plus ? Number.MAX_SAFE_INTEGER : n };
  }
  const [a, b] = nums;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function sizeMatchesBucket(sizeStr: string, bucket: SizeBucket): boolean {
  if (!bucket) return true;
  const r = sizeToRange(sizeStr);
  if (!r) return false;

  const { min, max } = r;
  switch (bucket) {
    case "lt100":
      return max < 100;
    case "lt1000":
      return max < 1000;
    case "lt10000":
      return max < 10000;
    case "gte10000":
      return min >= 10000 || max >= 10000;
    default:
      return true;
  }
}

/**
 * The data columns a user can show or hide. Order here is the order they
 * render in; Table pairs headers with Object.values(row) positionally, so the
 * header list and the cell object must be built from this same list.
 */
const COMPANY_COLUMNS = [
  { key: "name", label: "Company Name" },
  { key: "companyId", label: "Company ID" },
  { key: "companyType", label: "Company Type" },
  { key: "segment", label: "Segment" },
  { key: "region", label: "Region" },
  { key: "location", label: "Country" },
  { key: "contacts", label: "Contacts" },
] as const;

type CompanyColumnKey = (typeof COMPANY_COLUMNS)[number]["key"];

// Segment is off by default so the table looks unchanged for existing users.
const DEFAULT_COMPANY_COLUMNS = COMPANY_COLUMNS.filter(
  (c) => c.key !== "segment"
).map((c) => c.label);

const COMPANY_COLUMNS_KEY = "leadsentra.companies.columns";

type Row = {
  company_id: string;
  name: string; // trading_name || legal_name
  companyType: string; // replaces "industry"
  segment: string;     // Truck / Bus / Agriculture / ...
  size: string;
  city_regency: string; // shown as the "Region" column
  location: string; // raw country (kept from old behavior — see load())
  country: string;  // explicit country field
  contacts: number; // display count
  created_at?: string | null; // ISO timestamp from API
};

type CompanyFull = {
  company_id: string;
  company_name?: string | null;
  legal_name?: string | null;
  trading_name?: string | null;
  company_type?: string | null;
  size?: string | null;
  website?: string | null;
  head_office_address?: string | null;
  city_regency?: string | null;
  country?: string | null;
  postal_code?: string | null;
  phone_main?: string | null;
  email_general?: string | null;
  linkedin?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  notes?: string | null;

  // NEW fields
  company_profile?: string | null;
  financial_reports?: string | null; // link or text
  forecast_value?: number | null; // numeric forecast
  departments?: string[] | null; // e.g. ["LBI", "Research"]
};

type ContactMini = {
  id: string;
  contact_name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  department?: string | null;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  notes?: string | null;
};

type AssetsState = {
  financials: boolean;
  forecast: boolean;
  mgmt_pack: boolean;
};

export default function CompaniesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Staff (admin + moderator) can bulk-import; regular users can't.
  const canImport = isAdmin || user?.role === "moderator";

  // bulk delete (admin only)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);

  // data
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  // Admin-only select-all. Matches the contacts page: ticks every row that
  // passes the current filter (across pages), not just the visible page.
  const filteredCompanyIds = useMemo(() => rows.map((r) => r.company_id), [rows]);
  const allFilteredSelected =
    filteredCompanyIds.length > 0 &&
    filteredCompanyIds.every((id) => selectedIds.has(id));
  const someFilteredSelected =
    !allFilteredSelected &&
    filteredCompanyIds.some((id) => selectedIds.has(id));
  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredCompanyIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  // Which data columns the table shows. Chosen by label so the picker (a
  // MultiSelectFilter) can work in plain strings; Select/Actions aren't listed
  // because they're controls rather than data. Persisted per browser.
  // Declared before `headers` below, which reads it during render.
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    DEFAULT_COMPANY_COLUMNS
  );

  // Admin-only "Select" column drives the bulk-delete flow. Hidden for
  // everyone else so the checkboxes don't tease a capability they don't have.
  // The middle columns are user-selectable (see visibleColumns); Select and
  // Actions always show since they are controls, not data.
  const headers: (string | JSX.Element)[] = [
    ...(isAdmin
      ? [
          <SelectAllCheckbox
            key="select-all"
            allChecked={allFilteredSelected}
            someChecked={someFilteredSelected}
            onChange={toggleSelectAll}
            ariaLabel="Select all filtered companies"
          />,
        ]
      : []),
    ...COMPANY_COLUMNS.filter((c) => visibleColumns.includes(c.label)).map((c) => c.label),
    "Actions",
  ];

  // search / filters / sort / pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Restore the persisted column choice (see visibleColumns above).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COMPANY_COLUMNS_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) {
        // Drop labels from older builds that no longer exist.
        const known = parsed.filter((l: unknown): l is string =>
          COMPANY_COLUMNS.some((c) => c.label === l)
        );
        if (known.length) setVisibleColumns(known);
      }
    } catch {
      /* corrupt or unavailable storage — keep the defaults */
    }
  }, []);
  const changeColumns = (next: string[]) => {
    // Never leave the table with no data columns at all.
    const safe = next.length ? next : [COMPANY_COLUMNS[0].label];
    setVisibleColumns(safe);
    try {
      localStorage.setItem(COMPANY_COLUMNS_KEY, JSON.stringify(safe));
    } catch {
      /* private mode — the choice just won't persist */
    }
  };

  // companyType / country / segment hold MANY values (empty array = no filter).
  // They outgrew a native <select> once imports pushed the option lists into
  // the hundreds, so they render as searchable multi-selects.
  const [filters, setFilters] = useState<{
    companyType: string[];
    size: string;
    location: string;
    country: string[];
    segment: string[];
    dateFrom: string; // YYYY-MM-DD inclusive
    dateTo: string;   // YYYY-MM-DD inclusive
  }>({
    companyType: [],
    size: "",
    location: "",
    country: [],
    segment: [],
    dateFrom: "",
    dateTo: "",
  });

  // Segment dropdown — fed from the company_segments table.
  const [segmentOptions, setSegmentOptions] = useState<string[]>([]);
  const [newSegment, setNewSegment] = useState("");
  const [addingSegment, setAddingSegment] = useState(false);

  async function loadSegments() {
    try {
      const res = await fetch("/api/companies/segments", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setSegmentOptions(Array.isArray(json?.segments) ? json.segments : []);
    } catch { setSegmentOptions([]); }
  }
  async function addSegment() {
    const name = newSegment.trim();
    if (!name) return;
    setAddingSegment(true);
    try {
      const res = await fetch("/api/companies/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Failed to add segment");
      } else {
        setNewSegment("");
        await loadSegments();
        // Select the newly-added segment so the user immediately sees it filter.
        setFilters((f) => ({ ...f, segment: [name] }));
      }
    } finally {
      setAddingSegment(false);
    }
  }

  // Approved values for the three columns that feed filter dropdowns. The
  // dropdowns are built from these rather than from whatever is stored, so a
  // misspelling that arrived in a spreadsheet can't become a filter option —
  // it waits in "Needs review" instead.
  const [approvedTypes, setApprovedTypes] = useState<string[]>([]);
  const [approvedCountries, setApprovedCountries] = useState<string[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  async function loadVocab() {
    try {
      const res = await fetch("/api/companies/vocab", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setApprovedTypes(Array.isArray(json?.terms?.company_type) ? json.terms.company_type : []);
      setApprovedCountries(Array.isArray(json?.terms?.country) ? json.terms.country : []);
      setReviewCount(Array.isArray(json?.review) ? json.review.length : 0);
    } catch {
      // Endpoint unreachable (or the migration hasn't run): fall back to
      // building the dropdowns from the stored values, as before.
      setApprovedTypes([]);
      setApprovedCountries([]);
      setReviewCount(0);
    }
  }

  const [sortKey, setSortKey] = useState<
    "name" | "companyType" | "size" | "location"
  >("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<15 | 30 | 50>(15);

  // upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    dryRun?: boolean;
    parsed?: number;
    valid?: number;
    inserted?: number;
    updated?: number;
    failed?: number;
    errors?: { row: number; error: string }[];
    /** Misspellings the importer recognised and fixed on the way in. */
    corrections?: { field: string; from: string; to: string; rows: number }[];
    /** Values it couldn't place — held out of the filters until reviewed. */
    needsReview?: { field: string; value: string; rows: number; suggestion: string | null }[];
  } | null>(null);

  // modals
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyFull, setCompanyFull] = useState<CompanyFull | null>(null);
  const [assets, setAssets] = useState<AssetsState>({
    financials: false,
    forecast: false,
    mgmt_pack: false,
  });

  const [contactsModalOpen, setContactsModalOpen] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<ContactMini[]>([]);
  const [totalContacts, setTotalContacts] = useState<number | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    null
  );
  const [selectedCompanyName, setSelectedCompanyName] = useState<string>("");
  const [unlockedCount, setUnlockedCount] = useState<number>(0);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Edit company modal — uses PATCH /api/companies/[id]. The backend
  // only accepts the fields mapped below; we keep the form intentionally
  // small to match it (no schema drift).
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [editCompanyBusy, setEditCompanyBusy] = useState(false);
  const [editCompanyErr, setEditCompanyErr] = useState<string | null>(null);
  const [editCompanyForm, setEditCompanyForm] = useState({
    name: "",
    type: "",
    segment: "",
    size: "",
    region: "",
    phone: "",
    // Additional contact points beyond the main switchboard / general inbox.
    phone_main_2: "",
    phone_main_3: "",
    email_general: "",
    email_general_2: "",
    email_general_3: "",
    legal_name: "",
    trading_name: "",
    head_office_address: "",
    postal_code: "",
    company_profile: "",
    financial_reports: "",
    forecast_value: "",
    notes: "",
    website: "",
    linkedin: "",
    facebook_url: "",
    instagram_url: "",
    country: "",
    departments: [] as string[],
  });

  // True while the Segment field is a free-text box instead of the dropdown,
  // so a segment that doesn't exist yet can be typed in.
  const [customSegment, setCustomSegment] = useState(false);

  async function openCompanyEdit(r: Row) {
    setEditCompanyErr(null);
    setEditCompanyId(r.company_id);
    setCustomSegment(false);
    // Prefill from the row (full company is not always loaded; admin can
    // refine via the full company modal if they need more fields).
    setEditCompanyForm({
      name: r.name || "",
      type: r.companyType || "",
      segment: "",
      size: r.size || "",
      region: r.city_regency || "",
      phone: (r as any).phone || "",
      phone_main_2: "",
      phone_main_3: "",
      email_general: "",
      email_general_2: "",
      email_general_3: "",
      legal_name: "",
      trading_name: "",
      head_office_address: "",
      postal_code: "",
      company_profile: "",
      financial_reports: "",
      forecast_value: "",
      notes: "",
      website: "",
      linkedin: "",
      facebook_url: "",
      instagram_url: "",
      country: r.country || r.location || "",
      departments: [],
    });
    // Best-effort: pull the full record to fill segment/website/linkedin
    // and anything else the list query doesn't return.
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(r.company_id)}/full`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      const c = j?.company || j;
      if (c) {
        setEditCompanyForm((f) => ({
          ...f,
          name: c.company_name || c.trading_name || c.legal_name || f.name,
          type: c.company_type || c.industry || f.type,
          segment: c.segment || f.segment,
          size: c.size || f.size,
          region: c.city_regency || f.region,
          phone: c.phone_main || f.phone,
          phone_main_2: c.phone_main_2 || f.phone_main_2,
          phone_main_3: c.phone_main_3 || f.phone_main_3,
          email_general: c.email_general || f.email_general,
          email_general_2: c.email_general_2 || f.email_general_2,
          email_general_3: c.email_general_3 || f.email_general_3,
          legal_name: c.legal_name || f.legal_name,
          trading_name: c.trading_name || f.trading_name,
          head_office_address: c.head_office_address || f.head_office_address,
          postal_code: c.postal_code || f.postal_code,
          company_profile: c.company_profile || f.company_profile,
          financial_reports: c.financial_reports || f.financial_reports,
          forecast_value: c.forecast_value != null ? String(c.forecast_value) : f.forecast_value,
          notes: c.notes || f.notes,
          website: c.website || f.website,
          linkedin: c.linkedin || f.linkedin,
          facebook_url: c.facebook_url || f.facebook_url,
          instagram_url: c.instagram_url || f.instagram_url,
          country: c.country || f.country,
          departments: Array.isArray(c.departments) ? c.departments : f.departments,
        }));
      }
    } catch {
      // Non-fatal; user can still edit using the prefilled row values.
    }
  }

  async function saveCompanyEdit() {
    if (!editCompanyId) return;
    setEditCompanyBusy(true);
    setEditCompanyErr(null);
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(editCompanyId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: editCompanyForm.name.trim(),
          type: editCompanyForm.type.trim(),
          segment: editCompanyForm.segment.trim(),
          size: editCompanyForm.size.trim(),
          region: editCompanyForm.region.trim(),
          phone: editCompanyForm.phone.trim(),
          phone_main_2: editCompanyForm.phone_main_2.trim(),
          phone_main_3: editCompanyForm.phone_main_3.trim(),
          email_general: editCompanyForm.email_general.trim(),
          email_general_2: editCompanyForm.email_general_2.trim(),
          email_general_3: editCompanyForm.email_general_3.trim(),
          legal_name: editCompanyForm.legal_name.trim(),
          trading_name: editCompanyForm.trading_name.trim(),
          head_office_address: editCompanyForm.head_office_address.trim(),
          postal_code: editCompanyForm.postal_code.trim(),
          company_profile: editCompanyForm.company_profile.trim(),
          financial_reports: editCompanyForm.financial_reports.trim(),
          forecast_value: editCompanyForm.forecast_value.trim(),
          notes: editCompanyForm.notes.trim(),
          website: editCompanyForm.website.trim(),
          linkedin: editCompanyForm.linkedin.trim(),
          facebook_url: editCompanyForm.facebook_url.trim(),
          instagram_url: editCompanyForm.instagram_url.trim(),
          country: editCompanyForm.country.trim(),
          departments: editCompanyForm.departments,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");

      // Register a newly typed segment so it joins the dropdown everywhere
      // instead of only living on this one company. Best-effort: the company
      // itself already saved, so a failure here isn't worth blocking on.
      const seg = editCompanyForm.segment.trim();
      if (seg && !segmentOptions.includes(seg)) {
        try {
          await fetch("/api/companies/segments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ name: seg }),
          });
          await loadSegments();
        } catch {
          /* the company saved; the segment just isn't registered yet */
        }
      }

      toast({ title: "Company updated" });
      setEditCompanyId(null);
      await load();
    } catch (e: any) {
      setEditCompanyErr(e?.message || "Update failed");
    } finally {
      setEditCompanyBusy(false);
    }
  }
  const [form, setForm] = useState({
    company_id: "",
    company_name: "",
    legal_name: "",
    trading_name: "",
    company_type: "",
    segment: "",
    size: "",
    head_office_address: "",
    city_regency: "",
    country: "",
    postal_code: "",
    website: "",
    phone_main: "",
    email_general: "",
    linkedin: "",
    facebook_url: "",
    instagram_url: "",
    notes: "",
    // NEW fields (free text / URL / number)
    company_profile: "",
    financial_reports: "",
    forecast_value: "",
    departments: [] as string[],
  });
  // NEW: credit balance + confirm dialog
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState<{
    open: boolean;
    type: null | "financials" | "forecast" | "mgmt_pack";
    price: number;
    msg?: string;
  }>({ open: false, type: null, price: 10 });

  // NEW: fetch wallet balance
  async function fetchWalletBalance() {
    try {
      const res = await fetch("/api/wallet", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      setWalletBalance(typeof data?.balance === "number" ? data.balance : 0);
    } catch {
      setWalletBalance(null);
    }
  }

  useEffect(() => {
    load();
    fetchWalletBalance();
    loadSegments();
    loadVocab();
  }, []);

  // helpers
  const norm = (v?: string | null) => (v ?? "").toString().trim();
  // Filters compare on this, not on the raw string: MySQL stores
  // "Manufacturer" and "manufacturer" as the same value but JavaScript's Set
  // and === do not, which used to split one type across two filter options.
  const foldKey = (v?: string | null) => norm(v).toLowerCase();
  const includesI = (hay: string, needle: string) =>
    hay.toLowerCase().includes(needle.toLowerCase());

  // load companies list
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      const json = await res.json();

      if (Array.isArray(json?.data)) {
        const pruned = json.data.map((r: any) => {
          // Prefer the explicit `country` field; fall back to parsing the
          // legacy "City, Country" string for older rows that lack it.
          let country = r?.country ?? "";
          if (!country && r?.location) {
            const parts = String(r.location)
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean);
            country = parts.length > 1 ? parts[parts.length - 1] : "";
          }
          return {
            ...r,
            country,
            location: country, // keep existing filter compat (location filter == country)
          };
        });
        setAllRows(pruned as Row[]);
      } else {
        setAllRows([]);
      }
    } catch (e) {
      console.error(e);
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }

  // effects
  useEffect(() => {
    load();
  }, []);

  // Refresh on tab return — same pattern as the campaigns list, fixes the
  // "I added something in another tab and don't see it here" case.
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
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // search + filter + sort
  useEffect(() => {
    // Date filter bounds (parsed once per render).  Empty string → no bound.
    const fromTs = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
    const toTs   = filters.dateTo   ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : null;

    // Multi-select filters: empty array = no constraint, otherwise the row must
    // match one of the chosen values.
    const anyOf = (chosen: string[], value: string | null | undefined) =>
      chosen.length === 0 || chosen.some((c) => foldKey(c) === foldKey(value));

    let filtered = allRows.filter((r) => {
      if (!anyOf(filters.companyType, r.companyType)) return false;
      if (
        filters.size &&
        !sizeMatchesBucket(r.size, filters.size as SizeBucket)
      )
        return false;
      if (!anyOf(filters.country, r.country)) return false;
      if (!anyOf(filters.segment, r.segment)) return false;
      if (filters.location && norm(r.location) !== norm(filters.location))
        return false;
      if (fromTs !== null || toTs !== null) {
        const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
        if (Number.isNaN(t)) return false;
        if (fromTs !== null && t < fromTs) return false;
        if (toTs !== null && t > toTs) return false;
      }

      const s = norm(debouncedSearch);
      if (!s) return true;
      // company_id is included so pasting a code from an export, an invoice or
      // a support thread finds the row — it's the identifier people actually
      // quote to each other, and searching it used to return nothing.
      const hay = [r.company_id, r.name, r.companyType, r.size, r.country, r.location]
        .map(norm)
        .join("|");
      return includesI(hay, s);
    });

    filtered.sort((a, b) => {
      const av = norm(a[sortKey]).toLowerCase();
      const bv = norm(b[sortKey]).toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    setRows(filtered);
    setPage(1);
  }, [allRows, debouncedSearch, filters, sortKey, sortDir]);

  // options for select boxes (respect other filters/search)
  // Deduplicated case-insensitively — "Manufacturer" and "MANUFACTURER" are one
  // option, spelled the way it first appears.
  const uniqueSorted = (arr: string[]) =>
    Array.from(
      new Map(arr.filter(Boolean).map(norm).map((v) => [v.toLowerCase(), v])).values()
    ).sort((a, b) => a.localeCompare(b));

  /**
   * Keep only values that are on the approved list. An empty approved list
   * means the vocabulary isn't configured (or the endpoint is unreachable), in
   * which case we show everything rather than an empty dropdown.
   */
  const onlyApproved = (options: string[], approved: string[]) => {
    if (approved.length === 0) return options;
    const ok = new Set(approved.map((t) => t.toLowerCase()));
    return options.filter((o) => ok.has(o.toLowerCase()));
  };

  const companyTypeOptions = useMemo(() => {
    const base = allRows.filter(
      (r) =>
        (filters.size ? norm(r.size) === norm(filters.size) : true) &&
        (filters.location
          ? norm(r.location) === norm(filters.location)
          : true) &&
        (debouncedSearch
          ? includesI(
              [r.name, r.companyType, r.size, r.location].map(norm).join("|"),
              debouncedSearch
            )
          : true)
    );
    return onlyApproved(uniqueSorted(base.map((r) => r.companyType)), approvedTypes);
  }, [allRows, filters.size, filters.location, debouncedSearch, approvedTypes]);

  const sizeOptions = useMemo(() => {
    const base = allRows.filter(
      (r) =>
        (filters.companyType.length
          ? filters.companyType.some((c) => foldKey(c) === foldKey(r.companyType))
          : true) &&
        (filters.location
          ? norm(r.location) === norm(filters.location)
          : true) &&
        (debouncedSearch
          ? includesI(
              [r.name, r.companyType, r.size, r.location].map(norm).join("|"),
              debouncedSearch
            )
          : true)
    );
    return uniqueSorted(base.map((r) => r.size));
  }, [allRows, filters.companyType, filters.location, debouncedSearch]);

  const locationOptions = useMemo(() => {
    const base = allRows.filter(
      (r) =>
        (filters.companyType.length
          ? filters.companyType.some((c) => foldKey(c) === foldKey(r.companyType))
          : true) &&
        (filters.size ? norm(r.size) === norm(filters.size) : true) &&
        (debouncedSearch
          ? includesI(
              [r.name, r.companyType, r.size, r.location].map(norm).join("|"),
              debouncedSearch
            )
          : true)
    );
    return uniqueSorted(base.map((r) => r.location));
  }, [allRows, filters.companyType, filters.size, debouncedSearch]);

  // Country dropdown options — distinct, sorted, independent of other filters
  // so the user can always switch country without first clearing other choices.
  const countryOptions = useMemo(
    () => onlyApproved(uniqueSorted(allRows.map((r) => r.country)), approvedCountries),
    [allRows, approvedCountries]
  );

  // Segment options for the filter = the registered list plus anything actually
  // sitting on a row. Imported segments are registered on import now, but rows
  // loaded before that ran would otherwise be unfilterable.
  const segmentFilterOptions = useMemo(
    () => uniqueSorted([...segmentOptions, ...allRows.map((r) => r.segment)]),
    [segmentOptions, allRows]
  );

  function clearFilters() {
    setSearch("");
    setFilters({ companyType: [], size: "", location: "", country: [], segment: [], dateFrom: "", dateTo: "" });
    setSortKey("name");
    setSortDir("asc");
  }

  // pagination
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const currentRows = useMemo(
    () => rows.slice(startIdx, endIdx),
    [rows, startIdx, endIdx]
  );

  // upload
  const onUploadClick = () => fileRef.current?.click();
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/companies/import", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const { ok, json, message } = await readUploadResponse(res, file.size);
      if (ok) {
        setUploadResult(json);
        const parts = [
          `${json.inserted ?? 0} added`,
          `${json.updated ?? 0} updated`,
          `${json.failed ?? 0} failed`,
        ];
        if (json.needsReview?.length) parts.push(`${json.needsReview.length} to review`);
        toast({ title: "Import complete", description: parts.join(" · ") });
        await load();
        // Corrections and new unknown values change both lists.
        await loadVocab();
      } else {
        // Keep any row-level detail the API returned; otherwise show which
        // layer rejected the upload (proxy size limit, timeout, auth…).
        setUploadResult(json ?? { inserted: 0, errors: [{ row: -1, error: message }] });
        toast({
          variant: "destructive",
          title: "Import failed",
          description: message,
        });
      }
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error ? err.message : "Could not contact the server.";
      setUploadResult({
        inserted: 0,
        errors: [{ row: -1, error: `Upload failed — ${detail}` }],
      });
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: detail,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Are any filters narrowing the table right now? Drives the Export label. */
  const filtersActive =
    !!search.trim() ||
    filters.companyType.length > 0 ||
    filters.country.length > 0 ||
    filters.segment.length > 0 ||
    !!filters.size ||
    !!filters.location ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  // export — the server re-runs these filters in SQL, so a filtered download
  // covers every match, not just the page the browser is holding.
  const onExportClick = () => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("q", search.trim());
    filters.companyType.forEach((t) => p.append("type", t));
    filters.country.forEach((c) => p.append("country", c));
    filters.segment.forEach((s) => p.append("segment", s));
    if (filters.size) p.set("size", filters.size);
    if (filters.location) p.set("location", filters.location);
    if (filters.dateFrom) p.set("from", filters.dateFrom);
    if (filters.dateTo) p.set("to", filters.dateTo);
    const qs = p.toString();
    // Streamed download — keep it simple, just hit the endpoint
    window.location.href = `/api/companies/export${qs ? `?${qs}` : ""}`;
  };

  // open company details
  const openCompanyModal = async (company_id: string) => {
    setSelectedCompanyId(company_id);
    setCompanyModalOpen(true);
    setCompanyLoading(true);
    setCompanyError(null);
    setCompanyFull(null);
    setAssets({ financials: false, forecast: false, mgmt_pack: false });

    try {
      const res = await fetch(
        `/api/companies/${encodeURIComponent(company_id)}/full`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to fetch company");

      const c = json.company as CompanyFull;
      setCompanyFull(c);
      setAssets({
        financials: !!json?.assets?.financials_unlocked,
        forecast: !!json?.assets?.forecast_unlocked,
        mgmt_pack: !!json?.assets?.mgmt_pack_unlocked,
      });

      const display =
        c.trading_name || c.legal_name || c.company_name || c.company_id;
      setSelectedCompanyName(display ?? company_id);
      await fetchWalletBalance();
    } catch (e: any) {
      console.error(e);
      setCompanyError(e?.message || "Failed to load company details");
    } finally {
      setCompanyLoading(false);
    }
  };

  // open contacts modal (ONLY unlocked contacts)
  // Inline contact editing inside the Contact View modal.
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactEditBusy, setContactEditBusy] = useState(false);
  const [contactEditErr, setContactEditErr] = useState<string | null>(null);
  const [contactEditForm, setContactEditForm] = useState({
    contact_name: "",
    title: "",
    email: "",
    phone: "",
    linkedin_url: "",
  });

  function startContactEdit(c: ContactMini) {
    setContactEditErr(null);
    setEditingContactId(c.id);
    setContactEditForm({
      contact_name: c.contact_name || "",
      title: c.title || "",
      email: c.email || "",
      phone: c.phone || "",
      linkedin_url: c.linkedin_url || "",
    });
  }

  async function saveContactEdit() {
    if (!editingContactId) return;
    setContactEditBusy(true);
    setContactEditErr(null);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(editingContactId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          contact_name: contactEditForm.contact_name.trim(),
          title: contactEditForm.title.trim(),
          email: contactEditForm.email.trim(),
          phone: contactEditForm.phone.trim(),
          linkedin_url: contactEditForm.linkedin_url.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");

      // Patch the row in place — reopening the modal would lose the scroll
      // position and re-fetch the whole company for one changed field.
      setCompanyContacts((prev) =>
        prev.map((c) =>
          c.id === editingContactId
            ? {
                ...c,
                contact_name: contactEditForm.contact_name.trim(),
                title: contactEditForm.title.trim() || null,
                email: contactEditForm.email.trim() || null,
                phone: contactEditForm.phone.trim() || null,
                linkedin_url: contactEditForm.linkedin_url.trim() || null,
              }
            : c
        )
      );
      setEditingContactId(null);
      toast({ title: "Contact updated" });
    } catch (e: any) {
      setContactEditErr(e?.message || "Update failed");
    } finally {
      setContactEditBusy(false);
    }
  }

  const openContactsModal = async (company_id: string) => {
    setSelectedCompanyId(company_id);
    setContactsModalOpen(true);
    setContactsLoading(true);
    setContactsError(null);
    setCompanyContacts([]);
    setSelectedCompanyName("");
    setEditingContactId(null);
    setContactEditErr(null);

    // NEW: capture the total contacts you show in the table for this company
    const rowForCompany = allRows.find((r) => r.company_id === company_id);
    setTotalContacts(rowForCompany?.contacts ?? null);

    try {
      const res = await fetch(
        `/api/companies/${encodeURIComponent(company_id)}/full`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to fetch contacts");

      const list: ContactMini[] = Array.isArray(json.contacts)
        ? json.contacts
        : [];
      setCompanyContacts(list);
      setUnlockedCount(list.length);

      const c = json.company as CompanyFull;
      const display =
        c?.trading_name ||
        c?.legal_name ||
        c?.company_name ||
        c?.company_id ||
        "";
      setSelectedCompanyName(display);
    } catch (e: any) {
      console.error(e);
      setContactsError(e?.message || "Failed to load contacts");
    } finally {
      setContactsLoading(false);
    }
  };

  // table data mapping. Table renders Object.values(row) positionally against
  // `headers`, so a hidden column must be omitted from BOTH — hence building
  // the cells in COMPANY_COLUMNS order and skipping the ones switched off.
  const renderCell = (key: CompanyColumnKey, r: (typeof currentRows)[number]) => {
    switch (key) {
      case "name":
        return (
          <button
            onClick={() => openCompanyModal(r.company_id)}
            className="text-emerald-400 hover:underline"
            title="View company details"
          >
            {r.name}
          </button>
        );
      case "companyId":
        return (
          <span className="font-mono text-xs text-gray-400" title={r.company_id}>
            {r.company_id}
          </span>
        );
      case "companyType":
        return r.companyType || "—";
      case "segment":
        return r.segment || "—";
      // Header reads "Region"; backed by companies.meta.city_regency.
      case "region":
        return r.city_regency || "—";
      // Header reads "Country"; backed by companies.country (see load()).
      case "location":
        return r.location || "—";
      case "contacts":
        return (
          <button
            onClick={() => openContactsModal(r.company_id)}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs"
            title="View unlocked contacts"
          >
            View ({r.contacts})
          </button>
        );
      default:
        return "—";
    }
  };

  const tableData = currentRows.map((r) => {
    const cells: Record<string, JSX.Element | string> = {};
    if (isAdmin) {
      cells.Select = (
        <input
          type="checkbox"
          checked={selectedIds.has(r.company_id)}
          onChange={(e) => {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (e.target.checked) next.add(r.company_id);
              else next.delete(r.company_id);
              return next;
            });
          }}
          aria-label={`Select ${r.name}`}
        />
      );
    }
    for (const col of COMPANY_COLUMNS) {
      if (!visibleColumns.includes(col.label)) continue;
      cells[col.key] = renderCell(col.key, r);
    }
    cells.Actions = (
      <button
        onClick={() => openCompanyEdit(r)}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
        title="Edit company details"
      >
        <Pencil className="w-3.5 h-3.5" /> Edit
      </button>
    );
    return cells;
  });

  // admin: template CSV (now with new columns)
  async function downloadCompaniesTemplateCsv() {
    // Server-generated .xlsx so the `segment` column has a real Excel
    // data-validation dropdown bound to the live company_segments list.
    // Falls back to a basic CSV if the endpoint isn't reachable (e.g. older
    // build) so the Template button never appears broken.
    try {
      const res = await fetch("/api/companies/template", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "companies_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      return;
    } catch {
      // fall through to CSV
    }
    const cols = [
      "company_id",
      "company_name",
      "legal_name",
      "trading_name",
      "company_type",
      "segment",
      "size",
      "head_office_address",
      "city_regency",
      "country",
      "postal_code",
      "website",
      "phone_main",
      "phone_main_2",
      "phone_main_3",
      "email_general",
      "email_general_2",
      "email_general_3",
      "linkedin",
      "facebook_url",
      "instagram_url",
      "notes",
      "company_profile",
      "financial_reports",
      "forecast_value",
    ];
    const csv = cols.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "companies_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // admin: export current view to CSV
  function exportCurrentViewCsv() {
    const cols = [
      "company_id",
      "name",
      "companyType",
      "size",
      "location",
      "contacts",
    ];
    const lines = [cols.join(",")].concat(
      rows.map((r) =>
        [
          r.company_id,
          r.name?.replaceAll(",", " "),
          r.companyType?.replaceAll(",", " "),
          r.size?.replaceAll(",", " "),
          r.location?.replaceAll(",", " "),
          String(r.contacts ?? ""),
        ].join(",")
      )
    );
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "companies_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // unlock a paid company asset
  async function unlockAsset(type: "financials" | "forecast" | "mgmt_pack") {
    if (!selectedCompanyId) return;
    try {
      const res = await fetch("/api/company-assets/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: selectedCompanyId, type }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to unlock");

      // Refresh modal data
      await openCompanyModal(selectedCompanyId);
      if (type === "mgmt_pack") {
        // also refresh contacts count if they were unlocked by the pack
        await openContactsModal(selectedCompanyId);
        setContactsModalOpen(false); // don't leave it open
      }
      alert(json?.message || "Unlocked successfully");
    } catch (e: any) {
      alert(e?.message || "Unlock failed");
    }
  }

  // quick stats
  const statCompanies = allRows.length;
  const statTypes = useMemo(
    () => new Set(allRows.map((r) => norm(r.companyType))).size,
    [allRows]
  );
  const statLocations = useMemo(
    () => new Set(allRows.map((r) => norm(r.location))).size,
    [allRows]
  );

  function requiredPriceFor(type: "financials" | "forecast" | "mgmt_pack") {
    return 10; // all are 10 credits per your spec
  }

  async function handleUnlockClick(
    type: "financials" | "forecast" | "mgmt_pack"
  ) {
    // always refresh balance before deciding
    await fetchWalletBalance();
    setConfirmUnlock({ open: true, type, price: requiredPriceFor(type) });
  }

  async function confirmUnlockNow() {
    if (!selectedCompanyId || !confirmUnlock.type) return;

    const price = confirmUnlock.price;
    const balance = walletBalance ?? 0;

    // Client-side guard
    if (balance < price) {
      setConfirmUnlock((s) => ({
        ...s,
        msg: "Insufficient credits. Please add credits to proceed.",
      }));
      return;
    }

    // Server-side purchase (also guarded on backend)
    const res = await fetch("/api/company-assets/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: selectedCompanyId,
        type: confirmUnlock.type,
      }),
    });
    const json = await res.json();

    if (!res.ok) {
      setConfirmUnlock((s) => ({ ...s, msg: json?.error || "Unlock failed" }));
      await fetchWalletBalance();
      return;
    }

    // success
    setConfirmUnlock({ open: false, type: null, price: 10 });
    await fetchWalletBalance();
    await openCompanyModal(selectedCompanyId);
    if (confirmUnlock.type === "mgmt_pack") {
      await openContactsModal(selectedCompanyId);
      setContactsModalOpen(false);
    }
    alert(json?.message || "Unlocked successfully");
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Companies"
        description="Manage your company database and discover new prospects"
      >
        {/* Admin badge */}
        {isAdmin && (
          <span className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-emerald-900/40 text-emerald-200 border border-emerald-700">
            <Shield className="w-3 h-3" /> Admin
          </span>
        )}

        {/* Bulk import — staff only (admins + moderators).
            Regular users can't upload CSVs; they have the per-row "Add Company" modal instead. */}
        {/* Values stored on companies that aren't on the approved lists. Shown
            only when there are some, so a clean database has no extra chrome. */}
        {canImport && reviewCount > 0 && (
          <button
            onClick={() => setReviewOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
            title="Spelling mistakes and unknown values found in the company data"
          >
            <AlertTriangle className="w-4 h-4" />
            Needs review ({reviewCount})
          </button>
        )}

        {canImport && (
          <>
            <button
              onClick={downloadCompaniesTemplateCsv}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              title={
                segmentOptions.length
                  ? `Download CSV template.\nValid segment values: ${segmentOptions.join(", ")}`
                  : "Download CSV template. Add segments in the filter bar before importing."
              }
            >
              Template
            </button>

            <button
              onClick={onUploadClick}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              disabled={uploading}
            >
              <Upload className="w-4 h-4" />
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={fileRef}
              type="file"
              // The downloaded template is .xlsx (with the segment dropdown);
              // CSV is still accepted for backwards-compatible imports.
              accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onFileChange}
            />
          </>
        )}

        <button
          onClick={() => {
            setAddModalOpen(true);
            setSaveErr(null);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Company
        </button>

        <button
          onClick={onExportClick}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          title={
            filtersActive
              ? `Export the ${rows.length.toLocaleString()} companies matching your filters, as CSV`
              : "Export all your companies as CSV"
          }
        >
          <Download className="w-4 h-4" />
          {filtersActive ? "Export filtered" : "Export"}
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

        {/* Available for everyone */}
        {/* <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
          disabled={loading}
        >
          <RefreshCcw className="w-4 h-4" />
          {loading ? "Refreshing…" : "Refresh"}
        </button> */}
      </SectionHeader>

      <DataReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onApplied={async () => {
          await load();
          await loadVocab();
        }}
      />

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Companies" value={statCompanies} />
        <Stat label="Company Types" value={statTypes} />
        <Stat label="Locations" value={statLocations} />
      </div>

      {/* Search, filters, sort */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
        <div className="grid md:grid-cols-12 gap-3">
          {/* search */}
          <div className="md:col-span-5">
            <label htmlFor="companies-search" className="text-xs text-gray-400 block mb-1">Search</label>
            <input
              id="companies-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company ID, name, type, size, or location…"
              aria-label="Search companies"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>

          {/* type */}
          <div className="md:col-span-2">
            <MultiSelectFilter
              id="companies-type"
              label="Company Type"
              options={companyTypeOptions}
              selected={filters.companyType}
              onChange={(next) => setFilters((f) => ({ ...f, companyType: next }))}
              searchPlaceholder="Search types…"
            />
          </div>

          {/* country */}
          <div className="md:col-span-2">
            <MultiSelectFilter
              id="companies-country"
              label="Country"
              options={countryOptions}
              selected={filters.country}
              onChange={(next) => setFilters((f) => ({ ...f, country: next }))}
              searchPlaceholder="Search countries…"
            />
          </div>

          {/* segment — the "+ new segment" input lives in the footer row so the
              Segment cell stays the same height as its neighbours. */}
          <div className="md:col-span-2">
            <MultiSelectFilter
              id="companies-segment"
              label="Segment"
              options={segmentFilterOptions}
              selected={filters.segment}
              onChange={(next) => setFilters((f) => ({ ...f, segment: next }))}
              placeholder="All segments"
              searchPlaceholder="Search segments…"
            />
          </div>

          {/* created date range */}
          <div className="md:col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Added from</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Added to</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>

          {/* Footer row: Add-new-segment (staff only) + Clear + Showing count.
              Keeps the row count compact and stops "Clear" from sitting alone
              on a wide empty row. */}
          <div className="md:col-span-12 flex flex-wrap items-center gap-3">
            {canImport && (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newSegment}
                  onChange={(e) => setNewSegment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSegment(); } }}
                  placeholder="Add new segment…"
                  className="w-48 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={addSegment}
                  disabled={addingSegment || !newSegment.trim()}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs disabled:opacity-50"
                  title="Add segment"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg text-sm"
            >
              Clear
            </button>
            {/* Column chooser — which data columns the table shows. */}
            <div className="w-56">
              <MultiSelectFilter
                id="companies-columns"
                label="Columns"
                options={COMPANY_COLUMNS.map((c) => c.label)}
                selected={visibleColumns}
                onChange={changeColumns}
                placeholder="Choose columns"
                searchPlaceholder="Search columns…"
              />
            </div>
            <div className="ml-auto text-xs text-gray-400">
              Showing <b>{rows.length}</b> of <b>{allRows.length}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Upload result summary */}
      {uploadResult && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm">
          <div className="font-medium">Upload summary</div>
          <div className="mt-1">
            Parsed: <b>{uploadResult.parsed ?? 0}</b> • Added:{" "}
            <b>{uploadResult.inserted ?? 0}</b> • Updated:{" "}
            <b>{uploadResult.updated ?? 0}</b> • Failed:{" "}
            <b>{uploadResult.failed ?? 0}</b>
            {uploadResult.dryRun ? (
              <span className="ml-2 italic text-gray-400">(dry run)</span>
            ) : null}
          </div>
          {(uploadResult.updated ?? 0) > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              Rows matching a company already in the database updated it instead of
              creating a second copy. Blank cells left the stored value alone.
            </div>
          )}

          {/* Spellings the importer recognised and fixed on the way in. */}
          {Array.isArray(uploadResult.corrections) &&
            uploadResult.corrections.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-emerald-300">
                  Auto-corrected ({uploadResult.corrections.length})
                </summary>
                <ul className="mt-2 space-y-0.5">
                  {uploadResult.corrections.map((c, i) => (
                    <li key={i} className="text-xs text-gray-300">
                      <span className="text-gray-500">{c.field}:</span> “{c.from}” →{" "}
                      <b>“{c.to}”</b>{" "}
                      <span className="text-gray-500">
                        ({c.rows} {c.rows === 1 ? "row" : "rows"})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

          {/* Values nothing matched — imported, but held out of the filters. */}
          {Array.isArray(uploadResult.needsReview) &&
            uploadResult.needsReview.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
                <div className="flex items-center gap-2 text-amber-200 text-xs font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {uploadResult.needsReview.length} value
                  {uploadResult.needsReview.length === 1 ? "" : "s"} not recognised
                  {canImport && (
                    <button
                      onClick={() => setReviewOpen(true)}
                      className="ml-auto px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs"
                    >
                      Review now
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-amber-200/70 mt-1">
                  These rows imported, but the values stay out of the filter dropdowns
                  until someone confirms what they are.
                </p>
                <ul className="mt-2 space-y-0.5">
                  {uploadResult.needsReview.slice(0, 10).map((r, i) => (
                    <li key={i} className="text-xs text-gray-300">
                      <span className="text-gray-500">{r.field}:</span> “{r.value}”{" "}
                      <span className="text-gray-500">
                        ({r.rows} {r.rows === 1 ? "row" : "rows"})
                      </span>
                      {r.suggestion && (
                        <span className="text-gray-500"> — did you mean “{r.suggestion}”?</span>
                      )}
                    </li>
                  ))}
                  {uploadResult.needsReview.length > 10 && (
                    <li className="text-xs text-gray-500">
                      …and {uploadResult.needsReview.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            )}

          {Array.isArray(uploadResult.errors) &&
            uploadResult.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer">
                  Errors ({uploadResult.errors.length})
                </summary>
                <ul className="list-disc pl-5 mt-2">
                  {uploadResult.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No companies yet"
          description="Add your first company manually, or import a CSV from your existing CRM."
          primary={{
            label: "Add Company",
            onClick: () => { setAddModalOpen(true); setSaveErr(null); },
          }}
          secondary={canImport ? { label: "Import CSV", onClick: onUploadClick } : undefined}
        />
      ) : (
        <>
          <Table headers={headers} data={tableData} maxHeight="70vh" />

          {/* Pagination */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 py-4">
            <div className="text-sm text-gray-400">
              Showing <b>{total === 0 ? 0 : startIdx + 1}</b>–<b>{endIdx}</b> of{" "}
              <b>{total}</b>
            </div>
            <div className="flex items-center gap-3">
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
                {Array.from({ length: Math.min(7, totalPages) }).map((_, i) => {
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

      {/* Bulk Delete Confirm Modal — admin only.
          Server-side rule: companies with linked contacts are SKIPPED, not
          deleted. The dialog warns the user about this so a "delete 50, only
          20 went" result doesn't look like a bug. */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6">
            <h3 className="text-lg font-semibold text-white">
              Delete {selectedIds.size} compan{selectedIds.size === 1 ? "y" : "ies"}?
            </h3>
            <p className="mt-2 text-sm text-gray-300">
              This is permanent. Companies that still have linked contacts will
              be <b>skipped</b> — detach or delete their contacts first.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowBulkDelete(false)}
                disabled={bulkDeleteBusy}
                className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setBulkDeleteBusy(true);
                  try {
                    const ids = Array.from(selectedIds);
                    const res = await fetch("/api/companies/bulk-delete", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify({ ids }),
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(j?.error || "Delete failed");
                    toast({
                      title: "Companies deleted",
                      description: `${j.deleted ?? 0} removed${j.skipped ? ` · ${j.skipped} skipped (have contacts)` : ""}`,
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
                disabled={bulkDeleteBusy}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60"
              >
                {bulkDeleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Company Modal — owners can edit their own rows; staff can edit any.
          Backend PATCH /api/companies/[company_id] enforces ownership. */}
      {editCompanyId && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900">
            <div className="px-5 pt-5 pb-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Edit company</h3>
              {editCompanyErr && <div className="text-sm text-red-300">{editCompanyErr}</div>}
            </div>
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Company name</label>
                <input
                  value={editCompanyForm.name}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Company type</label>
                <input
                  value={editCompanyForm.type}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Segment</label>
                {segmentOptions.length > 0 && !customSegment ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={editCompanyForm.segment}
                      onChange={(e) => setEditCompanyForm((f) => ({ ...f, segment: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    >
                      <option value="">—</option>
                      {/* A segment that arrived by import may not be registered in
                          company_segments yet. Without an option to match it the
                          select renders blank and silently clears the value on
                          save, so surface the stored value as its own option. */}
                      {editCompanyForm.segment &&
                        !segmentOptions.includes(editCompanyForm.segment) && (
                          <option value={editCompanyForm.segment}>
                            {editCompanyForm.segment} (not in list)
                          </option>
                        )}
                      {segmentOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setCustomSegment(true)}
                      title="Type a segment that isn't in the list"
                      className="shrink-0 px-2.5 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      value={editCompanyForm.segment}
                      onChange={(e) => setEditCompanyForm((f) => ({ ...f, segment: e.target.value }))}
                      placeholder="Type a segment…"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    />
                    {segmentOptions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setCustomSegment(false)}
                        title="Pick from the existing list instead"
                        className="shrink-0 px-2.5 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs"
                      >
                        List
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-gray-500 mt-1">
                  A typed segment is registered for everyone when you save.
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Size</label>
                <input
                  value={editCompanyForm.size}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, size: e.target.value }))}
                  placeholder="e.g. 51 - 200"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Country</label>
                <input
                  value={editCompanyForm.country}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, country: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Region</label>
                <input
                  value={editCompanyForm.region}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, region: e.target.value }))}
                  placeholder="City / regency"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Phone (main)</label>
                <PhoneInput
                  value={editCompanyForm.phone}
                  onChange={(next) => setEditCompanyForm((f) => ({ ...f, phone: next }))}
                />
              </div>

              {/* Additional contact points. Collapsed by default — most
                  companies need only the main pair, and the extras used to be
                  typed into the notes field where nothing could use them. */}
              <details className="md:col-span-2 rounded-lg border border-gray-800 bg-gray-900/40">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm text-gray-300 hover:text-white">
                  More emails &amp; phone numbers
                </summary>
                <div className="px-3 pb-3 grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Email (general)</label>
                    <input
                      type="email"
                      value={editCompanyForm.email_general}
                      onChange={(e) => setEditCompanyForm((f) => ({ ...f, email_general: e.target.value }))}
                      placeholder="info@company.com"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Phone 2</label>
                    <PhoneInput
                      value={editCompanyForm.phone_main_2}
                      onChange={(next) => setEditCompanyForm((f) => ({ ...f, phone_main_2: next }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Email 2</label>
                    <input
                      type="email"
                      value={editCompanyForm.email_general_2}
                      onChange={(e) => setEditCompanyForm((f) => ({ ...f, email_general_2: e.target.value }))}
                      placeholder="sales@company.com"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Phone 3</label>
                    <PhoneInput
                      value={editCompanyForm.phone_main_3}
                      onChange={(next) => setEditCompanyForm((f) => ({ ...f, phone_main_3: next }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Email 3</label>
                    <input
                      type="email"
                      value={editCompanyForm.email_general_3}
                      onChange={(e) => setEditCompanyForm((f) => ({ ...f, email_general_3: e.target.value }))}
                      placeholder="support@company.com"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                    />
                  </div>
                </div>
              </details>

              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Website</label>
                <input
                  value={editCompanyForm.website}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, website: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">LinkedIn</label>
                <input
                  value={editCompanyForm.linkedin}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, linkedin: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Facebook URL</label>
                <input
                  value={editCompanyForm.facebook_url}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, facebook_url: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Instagram URL</label>
                <input
                  value={editCompanyForm.instagram_url}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, instagram_url: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              {/* The rest of what the Company Details modal shows. These were
                  readable there but had no field here, so correcting any of
                  them meant a re-import. */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Legal name</label>
                <input
                  value={editCompanyForm.legal_name}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, legal_name: e.target.value }))}
                  placeholder="Registered entity name"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Trading name</label>
                <input
                  value={editCompanyForm.trading_name}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, trading_name: e.target.value }))}
                  placeholder="Name used commercially"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Head office address</label>
                <textarea
                  rows={2}
                  value={editCompanyForm.head_office_address}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, head_office_address: e.target.value }))}
                  placeholder="Street, city, state"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Postal code</label>
                <input
                  value={editCompanyForm.postal_code}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, postal_code: e.target.value }))}
                  placeholder="e.g. 600002"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Company profile</label>
                <textarea
                  rows={3}
                  value={editCompanyForm.company_profile}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, company_profile: e.target.value }))}
                  placeholder="What this company does"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Financial reports</label>
                <textarea
                  rows={2}
                  value={editCompanyForm.financial_reports}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, financial_reports: e.target.value }))}
                  placeholder="Link or note"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Forecast value</label>
                <input
                  value={editCompanyForm.forecast_value}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, forecast_value: e.target.value }))}
                  placeholder="e.g. 250000"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editCompanyForm.notes}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Internal notes — never shown to the company"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Departments</label>
                <DepartmentsEditor
                  value={editCompanyForm.departments}
                  onChange={(next) => setEditCompanyForm((f) => ({ ...f, departments: next }))}
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-end gap-2">
              <button
                onClick={() => { setEditCompanyId(null); setEditCompanyErr(null); }}
                disabled={editCompanyBusy}
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={saveCompanyEdit}
                disabled={editCompanyBusy || !editCompanyForm.name.trim()}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
              >
                {editCompanyBusy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Company Modal */}
      {companyModalOpen && (
        <Modal
          onClose={() => setCompanyModalOpen(false)}
          title="Company Details"
        >
          {companyLoading ? (
            <div className="text-sm text-gray-300">Loading…</div>
          ) : companyError ? (
            <div className="text-sm text-red-300">{companyError}</div>
          ) : companyFull ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <Info label="Company ID" value={companyFull.company_id} />
                <Info
                  label="Display Name"
                  value={
                    companyFull.trading_name ||
                    companyFull.legal_name ||
                    companyFull.company_name ||
                    companyFull.company_id
                  }
                />
                <Info label="Company Type" value={companyFull.company_type} />
                <Info label="Size" value={companyFull.size} />
                <Info
                  label="Website"
                  value={
                    externalUrl(companyFull.website) ? (
                      <a
                        className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                        href={externalUrl(companyFull.website)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Globe className="w-4 h-4" /> {companyFull.website}
                      </a>
                    ) : (
                      ""
                    )
                  }
                />
                <Info label="Email" value={companyFull.email_general} />
                <Info label="Phone" value={companyFull.phone_main} />
                <Info label="Address" value={companyFull.head_office_address} />
                <Info label="City/Regency" value={companyFull.city_regency} />
                <Info label="Country" value={companyFull.country} />
                <Info label="Postal Code" value={companyFull.postal_code} />
                <Info
                  label="LinkedIn"
                  value={
                    externalUrl(companyFull.linkedin) ? (
                      <a
                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                        href={externalUrl(companyFull.linkedin)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Linkedin className="w-4 h-4" /> LinkedIn
                      </a>
                    ) : (
                      ""
                    )
                  }
                />
                <Info
                  label="Facebook"
                  value={
                    externalUrl(companyFull.facebook_url) ? (
                      <a
                        className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                        href={externalUrl(companyFull.facebook_url)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Facebook className="w-4 h-4" /> Facebook
                      </a>
                    ) : (
                      ""
                    )
                  }
                />
                <Info
                  label="Instagram"
                  value={
                    externalUrl(companyFull.instagram_url) ? (
                      <a
                        className="inline-flex items-center gap-1 text-pink-400 hover:underline"
                        href={externalUrl(companyFull.instagram_url)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Instagram className="w-4 h-4" /> Instagram
                      </a>
                    ) : (
                      ""
                    )
                  }
                />
                <div className="md:col-span-2">
                  <Info
                    label="Company Profile"
                    value={companyFull.company_profile}
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-gray-400">Departments</div>
                    <div className="col-span-2">
                      {companyFull.departments && companyFull.departments.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {companyFull.departments.map((d, i) => (
                            <span
                              key={`${d}-${i}`}
                              className="inline-flex items-center px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-200"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Unlockables */}
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Financials */}
                <UnlockCard
                  title="Company Financials"
                  price={10}
                  unlocked={assets.financials}
                  onUnlock={() => handleUnlockClick("financials")}
                >
                  {assets.financials ? (
                    companyFull.financial_reports ? (
                      /^https?:\/\//i.test(companyFull.financial_reports) ? (
                        <a
                          href={companyFull.financial_reports}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline"
                        >
                          Open financial report
                        </a>
                      ) : (
                        <span className="text-gray-200">
                          {companyFull.financial_reports}
                        </span>
                      )
                    ) : (
                      <span className="text-gray-400">
                        No financial report stored.
                      </span>
                    )
                  ) : (
                    <span className="text-gray-400">
                      Unlock to view financial reports.
                    </span>
                  )}
                </UnlockCard>

                {/* Forecast */}
                <UnlockCard
                  title="Company Forecast"
                  price={10}
                  unlocked={assets.forecast}
                  onUnlock={() => handleUnlockClick("forecast")}
                >
                  {assets.forecast ? (
                    companyFull.forecast_value != null ? (
                      <span className="text-gray-200">
                        Forecast value: <b>{companyFull.forecast_value}</b>
                      </span>
                    ) : (
                      <span className="text-gray-400">
                        No forecast value stored.
                      </span>
                    )
                  ) : (
                    <span className="text-gray-400">
                      Unlock to view forecast value.
                    </span>
                  )}
                </UnlockCard>

                {/* Management Pack */}
                <UnlockCard
                  title="Management Pack (3 contacts)"
                  price={10}
                  unlocked={assets.mgmt_pack}
                  onUnlock={() => handleUnlockClick("mgmt_pack")}
                >
                  {assets.mgmt_pack ? (
                    <span className="text-gray-200">
                      Up to 3 management-level contacts for this company have
                      been unlocked and are visible in the Contacts modal.
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      Unlock a curated set of management roles
                      (CEO/Head/Director/Manager/VP).
                    </span>
                  )}
                </UnlockCard>
              </div>
            </>
          ) : null}
        </Modal>
      )}

      {/* Contacts Modal — only unlocked contacts (server already filters) */}
      {contactsModalOpen && (
        <Modal
          onClose={() => setContactsModalOpen(false)}
          title={`Contacts ${
            selectedCompanyName ? `— ${selectedCompanyName}` : ""
          }`}
        >
          {contactsLoading ? (
            <div className="text-sm text-gray-300">Loading…</div>
          ) : contactsError ? (
            <div className="text-sm text-red-300">{contactsError}</div>
          ) : (
            <>
              <div className="text-xs text-gray-400 mb-2">
                Showing <b>{unlockedCount}</b> unlocked contact
                {unlockedCount === 1 ? "" : "s"}.
              </div>
              {companyContacts.length === 0 ? (
                <div className="text-sm text-gray-400">
                  No unlocked contacts for this company yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {!contactsLoading && !contactsError && (
                    <>
                      {/* Redirect CTA if none unlocked OR some still locked */}
                      {unlockedCount === 0 ||
                      (totalContacts != null &&
                        unlockedCount < totalContacts) ? (
                        <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-amber-200">
                              {unlockedCount === 0 ? (
                                <span>
                                  No contacts are unlocked for this company yet.
                                </span>
                              ) : (
                                <span>
                                  You have unlocked <b>{unlockedCount}</b>
                                  {totalContacts != null ? (
                                    <>
                                      {" "}
                                      of <b>{totalContacts}</b>
                                    </>
                                  ) : null}{" "}
                                  contacts. Some contacts are still locked.
                                </span>
                              )}
                            </div>
                            <a
                              href="/portal/contacts"
                              className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              Go to Contacts
                            </a>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                  {contactEditErr && (
                    <div className="mb-2 rounded border border-red-700 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                      {contactEditErr}
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-gray-700">
                        <th className="py-2 pr-4">Name</th>
                        <th className="py-2 pr-4">Title</th>
                        <th className="py-2 pr-4">Email</th>
                        <th className="py-2 pr-4">Phone</th>
                        <th className="py-2 pr-4">Social</th>
                        <th className="py-2 pr-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyContacts.map((c) =>
                        editingContactId === c.id ? (
                          // Inline edit row — saves straight to PATCH /api/contacts/:id
                          // so a wrong phone or email can be fixed here instead of
                          // navigating to the Contacts page and searching for it.
                          <tr key={c.id} className="border-b border-gray-800 bg-gray-800/40">
                            <td className="py-2 pr-4">
                              <input
                                value={contactEditForm.contact_name}
                                onChange={(e) =>
                                  setContactEditForm((f) => ({ ...f, contact_name: e.target.value }))
                                }
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={contactEditForm.title}
                                onChange={(e) =>
                                  setContactEditForm((f) => ({ ...f, title: e.target.value }))
                                }
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={contactEditForm.email}
                                onChange={(e) =>
                                  setContactEditForm((f) => ({ ...f, email: e.target.value }))
                                }
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={contactEditForm.phone}
                                onChange={(e) =>
                                  setContactEditForm((f) => ({ ...f, phone: e.target.value }))
                                }
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={contactEditForm.linkedin_url}
                                onChange={(e) =>
                                  setContactEditForm((f) => ({ ...f, linkedin_url: e.target.value }))
                                }
                                placeholder="LinkedIn URL"
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={saveContactEdit}
                                  disabled={contactEditBusy}
                                  className="px-2.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                                >
                                  {contactEditBusy ? "Saving…" : "Save"}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingContactId(null);
                                    setContactEditErr(null);
                                  }}
                                  disabled={contactEditBusy}
                                  className="px-2.5 py-1 text-xs rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={c.id} className="border-b border-gray-800">
                            <td className="py-2 pr-4">{c.contact_name}</td>
                            <td className="py-2 pr-4">{c.title || ""}</td>
                            <td className="py-2 pr-4">
                              {c.email ? (
                                <a
                                  className="text-emerald-400 hover:underline"
                                  href={`mailto:${c.email}`}
                                >
                                  {c.email}
                                </a>
                              ) : (
                                ""
                              )}
                            </td>
                            <td className="py-2 pr-4">{c.phone || ""}</td>
                            <td className="py-2 pr-4">
                              <div className="flex items-center gap-1">
                                <SocialIcon url={c.linkedin_url} label="LinkedIn">
                                  <Linkedin className="w-4 h-4" />
                                </SocialIcon>
                                <SocialIcon url={c.facebook_url} label="Facebook">
                                  <Facebook className="w-4 h-4" />
                                </SocialIcon>
                                <SocialIcon
                                  url={c.instagram_url}
                                  label="Instagram"
                                >
                                  <Instagram className="w-4 h-4" />
                                </SocialIcon>
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              <div className="flex justify-end">
                                <button
                                  onClick={() => startContactEdit(c)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
                                  title="Edit this contact"
                                >
                                  <Pencil className="w-3.5 h-3.5" /> Edit
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {/* Add Company Modal */}

      {addModalOpen && (
        <AddCompanyModal
          form={form}
          setForm={setForm}
          onClose={() => setAddModalOpen(false)}
          saveBusy={saveBusy}
          saveErr={saveErr}
          setSaveBusy={setSaveBusy}
          setSaveErr={setSaveErr}
          reload={load}
          segmentOptions={segmentOptions}
          onAddSegment={addSegment}
          newSegment={newSegment}
          setNewSegment={setNewSegment}
          addingSegment={addingSegment}
          canScan={canImport}
        />
      )}
      {confirmUnlock.open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() =>
              setConfirmUnlock({ open: false, type: null, price: 10 })
            }
          />
          <div className="absolute inset-x-0 top-24 mx-auto w-[min(520px,95%)] rounded-2xl bg-gray-900 border border-gray-700 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold">Confirm Purchase</h3>
              <button
                onClick={() =>
                  setConfirmUnlock({ open: false, type: null, price: 10 })
                }
                className="text-gray-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="text-gray-300">
                You’re about to unlock:{" "}
                <b className="capitalize">
                  {confirmUnlock.type?.replace("_", " ")}
                </b>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Current credits</span>
                  <b className="text-white">{walletBalance ?? 0}</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Cost</span>
                  <b className="text-white">-{confirmUnlock.price}</b>
                </div>
                <div className="flex items-center justify-between border-t border-gray-800 mt-2 pt-2">
                  <span className="text-gray-400">Balance after</span>
                  <b
                    className={
                      (walletBalance ?? 0) - confirmUnlock.price < 0
                        ? "text-rose-300"
                        : "text-white"
                    }
                  >
                    {(walletBalance ?? 0) - confirmUnlock.price}
                  </b>
                </div>
              </div>
              {confirmUnlock.msg && (
                <div className="text-rose-300 border border-rose-700/50 bg-rose-950/40 rounded-lg px-3 py-2">
                  {confirmUnlock.msg}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-700 flex items-center justify-end gap-2">
              <button
                onClick={() =>
                  setConfirmUnlock({ open: false, type: null, price: 10 })
                }
                className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmUnlockNow}
                disabled={(walletBalance ?? 0) < confirmUnlock.price}
                className={`px-3 py-2 rounded-lg text-sm ${
                  (walletBalance ?? 0) < confirmUnlock.price
                    ? "bg-gray-700 text-gray-300 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                {(walletBalance ?? 0) < confirmUnlock.price
                  ? "Insufficient credits"
                  : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------- Small UI helpers ------- */

function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 top-10 mx-auto w-[min(1000px,95%)] rounded-2xl bg-gray-900 border border-gray-700 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-300 hover:text-white">
            ✕
          </button>
        </div>
        <div className="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: any }) {
  const v = value ?? "";
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-gray-400">{label}</div>
      <div className="col-span-2 text-gray-200 break-words">
        {v || <span className="text-gray-500">—</span>}
      </div>
    </div>
  );
}

function SocialIcon({
  url,
  label,
  children,
}: {
  url?: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const cls =
    "inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-700 transition-colors";
  const disabled =
    "inline-flex items-center justify-center w-8 h-8 rounded-md opacity-40 cursor-not-allowed";
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      title={`Open ${label}`}
    >
      {children}
    </a>
  ) : (
    <span className={disabled} title={`No ${label}`}>
      {children}
    </span>
  );
}

// Tag-style editor for a company's departments. Add via Enter or the "+"
// button, remove via the "×" on each chip. De-dupes case-insensitively so the
// same department can't be added twice. Used by both the Add and Edit modals.
function DepartmentsEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (value.some((d) => d.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, v]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.length === 0 ? (
          <span className="text-xs text-gray-500">No departments added yet.</span>
        ) : (
          value.map((d, i) => (
            <span
              key={`${d}-${i}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-200"
            >
              {d}
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-gray-400 hover:text-rose-300"
                aria-label={`Remove ${d}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. LBI, Research…"
          className="flex-1 min-w-0 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-50"
          title="Add department"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
    </div>
  );
}

function UnlockCard({
  title,
  price,
  unlocked,
  onUnlock,
  children,
}: {
  title: string;
  price: number;
  unlocked: boolean;
  onUnlock: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">{title}</div>
        {unlocked ? (
          <span className="inline-flex items-center gap-1 text-emerald-300 text-xs">
            <CheckCircle2 className="w-4 h-4" /> Unlocked
          </span>
        ) : (
          <button
            onClick={onUnlock}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
          >
            <Lock className="w-4 h-4" /> Unlock • {price} credits
          </button>
        )}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/* tiny utility classes for consistency */
const inputBase =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors";
const taBase =
  "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors";
const btnBase = "px-3 py-2 rounded-lg text-sm";
const btnPri =
  "bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60";
const btnSec = "bg-gray-800 border border-gray-700 hover:border-gray-600";
Object.assign(globalThis, {
  input: inputBase,
  textarea: taBase,
  "btn-primary": `${btnBase} ${btnPri}`,
  "btn-secondary": `${btnBase} ${btnSec}`,
});

function AddCompanyModal({
  form,
  setForm,
  onClose,
  saveBusy,
  saveErr,
  setSaveBusy,
  setSaveErr,
  reload,
  segmentOptions,
  onAddSegment,
  newSegment,
  setNewSegment,
  addingSegment,
  canScan,
}: {
  form: {
    company_id: string;
    company_name: string;
    legal_name: string;
    trading_name: string;
    company_type: string;
    segment: string;
    size: string;
    head_office_address: string;
    city_regency: string;
    country: string;
    postal_code: string;
    website: string;
    phone_main: string;
    email_general: string;
    linkedin: string;
    facebook_url: string;
    instagram_url: string;
    notes: string;
    company_profile: string;
    financial_reports: string;
    forecast_value: string;
    departments: string[];
  };
  setForm: (f: any) => void;
  onClose: () => void;
  saveBusy: boolean;
  saveErr: string | null;
  setSaveBusy: (b: boolean) => void;
  setSaveErr: (s: string | null) => void;
  reload: () => Promise<void>;
  segmentOptions: string[];
  onAddSegment: () => Promise<void>;
  newSegment: string;
  setNewSegment: (s: string) => void;
  addingSegment: boolean;
  canScan: boolean;
}) {
  const [tab, setTab] = useState<"basics" | "contact" | "profile">("basics");
  const [touched, setTouched] = useState<{ id?: boolean; name?: boolean }>({});

  const requiredMissing = !form.company_id.trim() || !form.company_name.trim();

  async function onSave() {
    try {
      setSaveBusy(true);
      setSaveErr(null);
      if (!form.company_name.trim()) {
        setTouched({ id: true, name: true });
        throw new Error("Company Name is required");
      }
      // Send the full form. The server saves the columns it has direct
      // mappings for and stores the rest in the meta JSON column so the
      // values don't get dropped on the floor.
      const payload = {
        code: form.company_id.trim() || undefined,  // server auto-generates if blank
        name: form.company_name.trim(),
        type: form.company_type || null,
        segment: form.segment || null,
        size: form.size || null,
        website: form.website || null,
        linkedin: form.linkedin || null,
        facebook_url: form.facebook_url || null,
        instagram_url: form.instagram_url || null,
        country: form.country || null,
        city_regency: form.city_regency || null,
        phone_main: form.phone_main || null,
        legal_name: form.legal_name || null,
        trading_name: form.trading_name || null,
        head_office_address: form.head_office_address || null,
        postal_code: form.postal_code || null,
        email_general: form.email_general || null,
        notes: form.notes || null,
        company_profile: form.company_profile || null,
        financial_reports: form.financial_reports || null,
        forecast_value: form.forecast_value || null,
        departments: form.departments,
      };
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create company");

      toast({
        title: "Company added",
        description: payload.name,
      });

      // reset and close
      setForm({
        company_id: "",
        company_name: "",
        legal_name: "",
        trading_name: "",
        company_type: "",
        segment: "",
        size: "",
        head_office_address: "",
        city_regency: "",
        country: "",
        postal_code: "",
        website: "",
        phone_main: "",
        email_general: "",
        linkedin: "",
        facebook_url: "",
        instagram_url: "",
        notes: "",
        company_profile: "",
        financial_reports: "",
        forecast_value: "",
        departments: [],
      });
      await reload();
      onClose();
    } catch (e: any) {
      setSaveErr(e?.message || "Failed to add company");
    } finally {
      setSaveBusy(false);
    }
  }

  // Keyboard: Ctrl/Cmd + Enter to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "enter") {
        e.preventDefault();
        if (!saveBusy) onSave();
      }
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveBusy, onSave]);

  const fieldCls =
    "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors";
  const danger = "text-rose-300 text-xs mt-1";
  const labelCls = "text-xs text-gray-400 block mb-1";

  const profileLen = form.company_profile?.length ?? 0;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 top-6 mx-auto w-[min(1200px,96%)] rounded-2xl bg-gray-900 border border-gray-700 shadow-xl flex flex-col max-h-[75vh]">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-700 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Add Company</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Fill required fields, then press{" "}
              <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded">
                Ctrl/Cmd + Enter
              </kbd>{" "}
              to save.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-white">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3">
          <div className="inline-flex items-center gap-2 p-1 rounded-lg bg-gray-800 border border-gray-700">
            {[
              { id: "basics", label: "Basics" },
              { id: "contact", label: "Contacts & Links" },
              { id: "profile", label: "Profile & Financials" },
            ].map((t: any) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-md text-sm ${
                  tab === t.id
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content (scrollable) */}
        <div className="px-5 py-4 overflow-y-auto">
          {saveErr && (
            <div className="mb-3 text-sm text-rose-300 border border-rose-700/50 bg-rose-950/40 rounded-lg px-3 py-2">
              {saveErr}
            </div>
          )}

          {canScan && (
            <CardScanButton
              label="Have a business card? Scan it to auto-fill the basics."
              onExtract={(data: ScanExtracted) => {
                const co = data.company ?? {};
                setForm((prev: any) => ({
                  ...prev,
                  company_name: prev.company_name || (co.name ?? ""),
                  trading_name: prev.trading_name || (co.name ?? ""),
                  website:      prev.website      || (co.website ?? ""),
                  country:      prev.country      || (co.country ?? ""),
                  city_regency: prev.city_regency || (co.city_regency ?? ""),
                  company_type: prev.company_type || (co.industry ?? ""),
                  // contact info from the card lands in notes so it isn't lost
                  // when creating a company without an immediate contact row.
                  phone_main:    prev.phone_main    || (data.contact?.phone ?? ""),
                  email_general: prev.email_general || (data.contact?.email ?? ""),
                }));
              }}
            />
          )}

          {tab === "basics" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>
                  Company ID <span className="text-rose-400">*</span>
                </span>
                <input
                  className={`${fieldCls} ${
                    touched.id && !form.company_id.trim()
                      ? "border-rose-700 focus:ring-rose-500"
                      : ""
                  }`}
                  placeholder="ACME-001"
                  value={form.company_id}
                  onBlur={() => setTouched((t) => ({ ...t, id: true }))}
                  onChange={(e) =>
                    setForm({ ...form, company_id: e.target.value })
                  }
                />
                {touched.id && !form.company_id.trim() && (
                  <div className={danger}>Company ID is required.</div>
                )}
              </label>

              <label className="block">
                <span className={labelCls}>
                  Company Name <span className="text-rose-400">*</span>
                </span>
                <input
                  className={`${fieldCls} ${
                    touched.name && !form.company_name.trim()
                      ? "border-rose-700 focus:ring-rose-500"
                      : ""
                  }`}
                  placeholder="Acme Inc."
                  value={form.company_name}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  onChange={(e) =>
                    setForm({ ...form, company_name: e.target.value })
                  }
                />
                {touched.name && !form.company_name.trim() && (
                  <div className={danger}>Company Name is required.</div>
                )}
              </label>

              <label className="block">
                <span className={labelCls}>Legal Name</span>
                <input
                  className={fieldCls}
                  value={form.legal_name}
                  onChange={(e) =>
                    setForm({ ...form, legal_name: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>Trading Name</span>
                <input
                  className={fieldCls}
                  value={form.trading_name}
                  onChange={(e) =>
                    setForm({ ...form, trading_name: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>Company Type</span>
                <input
                  className={fieldCls}
                  placeholder="Private / Public / LLC…"
                  value={form.company_type}
                  onChange={(e) =>
                    setForm({ ...form, company_type: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>Segment</span>
                <select
                  className={fieldCls}
                  value={form.segment}
                  onChange={(e) => setForm({ ...form, segment: e.target.value })}
                >
                  <option value="">— None —</option>
                  {segmentOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <div className="mt-1 flex gap-1">
                  <input
                    type="text"
                    placeholder="Add new segment…"
                    value={newSegment}
                    onChange={(e) => setNewSegment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddSegment(); } }}
                    className="flex-1 min-w-0 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 placeholder-gray-500"
                  />
                  <button
                    type="button"
                    onClick={onAddSegment}
                    disabled={addingSegment || !newSegment.trim()}
                    className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              </label>

              <label className="block">
                <span className={labelCls}>Size</span>
                <input
                  className={fieldCls}
                  placeholder="1–10, 11–50, 51–200…"
                  value={form.size}
                  onChange={(e) => setForm({ ...form, size: e.target.value })}
                />
              </label>

              <div className="block md:col-span-2">
                <span className={labelCls}>Departments</span>
                <DepartmentsEditor
                  value={form.departments}
                  onChange={(next) => setForm({ ...form, departments: next })}
                />
                <div className="text-[11px] text-gray-500 mt-1">
                  Add the company’s departments (e.g. LBI, Research). Press Enter
                  or “+” to add each one.
                </div>
              </div>
            </div>
          )}

          {tab === "contact" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Website</span>
                <input
                  className={fieldCls}
                  placeholder="https://…"
                  value={form.website}
                  onChange={(e) =>
                    setForm({ ...form, website: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className={labelCls}>LinkedIn</span>
                <input
                  className={fieldCls}
                  placeholder="https://linkedin.com/company/…"
                  value={form.linkedin}
                  onChange={(e) =>
                    setForm({ ...form, linkedin: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className={labelCls}>Facebook URL</span>
                <input
                  className={fieldCls}
                  placeholder="https://facebook.com/…"
                  value={form.facebook_url}
                  onChange={(e) =>
                    setForm({ ...form, facebook_url: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className={labelCls}>Instagram URL</span>
                <input
                  className={fieldCls}
                  placeholder="https://instagram.com/…"
                  value={form.instagram_url}
                  onChange={(e) =>
                    setForm({ ...form, instagram_url: e.target.value })
                  }
                />
              </label>

              <label className="block md:col-span-2">
                <span className={labelCls}>Head Office Address</span>
                <input
                  className={fieldCls}
                  value={form.head_office_address}
                  onChange={(e) =>
                    setForm({ ...form, head_office_address: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>City/Regency</span>
                <input
                  className={fieldCls}
                  value={form.city_regency}
                  onChange={(e) =>
                    setForm({ ...form, city_regency: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className={labelCls}>Country</span>
                <input
                  className={fieldCls}
                  value={form.country}
                  onChange={(e) =>
                    setForm({ ...form, country: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>Postal Code</span>
                <input
                  className={fieldCls}
                  value={form.postal_code}
                  onChange={(e) =>
                    setForm({ ...form, postal_code: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>Main Phone</span>
                <PhoneInput
                  value={form.phone_main}
                  onChange={(next) => setForm({ ...form, phone_main: next })}
                />
              </label>

              <label className="block">
                <span className={labelCls}>General Email</span>
                <input
                  className={fieldCls}
                  placeholder="hello@company.com"
                  value={form.email_general}
                  onChange={(e) =>
                    setForm({ ...form, email_general: e.target.value })
                  }
                />
              </label>
            </div>
          )}

          {tab === "profile" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block md:col-span-2">
                <span className={labelCls}>Company Profile</span>
                <textarea
                  rows={5}
                  className={fieldCls}
                  value={form.company_profile}
                  onChange={(e) =>
                    setForm({ ...form, company_profile: e.target.value })
                  }
                  placeholder="Short description, market, products, etc."
                />
                <div className="text-[11px] text-gray-500 mt-1">
                  {profileLen} characters
                </div>
              </label>

              <label className="block">
                <span className={labelCls}>
                  Financial Reports (URL or text)
                </span>
                <input
                  className={fieldCls}
                  placeholder="https://… or free text"
                  value={form.financial_reports}
                  onChange={(e) =>
                    setForm({ ...form, financial_reports: e.target.value })
                  }
                />
              </label>

              <label className="block">
                <span className={labelCls}>Forecast Value (number)</span>
                <input
                  className={fieldCls}
                  inputMode="numeric"
                  placeholder="e.g. 1250000"
                  value={form.forecast_value}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      forecast_value: e.target.value.replace(/[^\d.]/g, ""),
                    })
                  }
                />
              </label>

              <label className="block md:col-span-2">
                <span className={labelCls}>Internal Notes</span>
                <textarea
                  rows={3}
                  className={fieldCls}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 z-10 bg-gray-900/95 backdrop-blur border-t border-gray-700 px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={saveBusy}
            onClick={onSave}
            className="px-3 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
          >
            {saveBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
