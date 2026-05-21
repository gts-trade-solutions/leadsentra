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
import {
  Plus,
  Upload,
  RefreshCcw,
  Linkedin,
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
  notes?: string | null;

  // NEW fields
  company_profile?: string | null;
  financial_reports?: string | null; // link or text
  forecast_value?: number | null; // numeric forecast
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

  // Admin-only "Select" column drives the bulk-delete flow. Hidden for
  // everyone else so the checkboxes don't tease a capability they don't have.
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
    "Company Name",
    "Company Type",
    "Region",
    "Location",
    "Contacts",
    "Actions",
  ];

  // search / filters / sort / pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<{
    companyType: string;
    size: string;
    location: string;
    country: string;
    segment: string;
    dateFrom: string; // YYYY-MM-DD inclusive
    dateTo: string;   // YYYY-MM-DD inclusive
  }>({
    companyType: "",
    size: "",
    location: "",
    country: "",
    segment: "",
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
        setFilters((f) => ({ ...f, segment: name }));
      }
    } finally {
      setAddingSegment(false);
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
    errors?: { row: number; error: string }[];
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
    website: "",
    linkedin: "",
    country: "",
  });

  async function openCompanyEdit(r: Row) {
    setEditCompanyErr(null);
    setEditCompanyId(r.company_id);
    // Prefill from the row (full company is not always loaded; admin can
    // refine via the full company modal if they need more fields).
    setEditCompanyForm({
      name: r.name || "",
      type: r.companyType || "",
      segment: "",
      size: r.size || "",
      region: r.city_regency || "",
      phone: (r as any).phone || "",
      website: "",
      linkedin: "",
      country: r.country || r.location || "",
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
          website: c.website || f.website,
          linkedin: c.linkedin || f.linkedin,
          country: c.country || f.country,
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
          website: editCompanyForm.website.trim(),
          linkedin: editCompanyForm.linkedin.trim(),
          country: editCompanyForm.country.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Update failed");
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
    notes: "",
    // NEW fields (free text / URL / number)
    company_profile: "",
    financial_reports: "",
    forecast_value: "",
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
  }, []);

  // helpers
  const norm = (v?: string | null) => (v ?? "").toString().trim();
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
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // search + filter + sort
  useEffect(() => {
    // Date filter bounds (parsed once per render).  Empty string → no bound.
    const fromTs = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
    const toTs   = filters.dateTo   ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : null;

    let filtered = allRows.filter((r) => {
      if (
        filters.companyType &&
        norm(r.companyType) !== norm(filters.companyType)
      )
        return false;
      if (
        filters.size &&
        !sizeMatchesBucket(r.size, filters.size as SizeBucket)
      )
        return false;
      if (filters.country && norm(r.country) !== norm(filters.country))
        return false;
      if (filters.segment && norm(r.segment) !== norm(filters.segment))
        return false;
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
      const hay = [r.name, r.companyType, r.size, r.country, r.location]
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
  const uniqueSorted = (arr: string[]) =>
    Array.from(new Set(arr.filter(Boolean).map(norm))).sort((a, b) =>
      a.localeCompare(b)
    );

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
    return uniqueSorted(base.map((r) => r.companyType));
  }, [allRows, filters.size, filters.location, debouncedSearch]);

  const sizeOptions = useMemo(() => {
    const base = allRows.filter(
      (r) =>
        (filters.companyType
          ? norm(r.companyType) === norm(filters.companyType)
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
        (filters.companyType
          ? norm(r.companyType) === norm(filters.companyType)
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
    () => uniqueSorted(allRows.map((r) => r.country)),
    [allRows]
  );

  function clearFilters() {
    setSearch("");
    setFilters({ companyType: "", size: "", location: "", country: "", segment: "", dateFrom: "", dateTo: "" });
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
      const json = await res.json();
      setUploadResult(json);
      if (res.ok) {
        toast({
          title: "Import complete",
          description: `${json.inserted ?? 0} added · ${json.failed ?? 0} failed`,
        });
        await load();
      } else {
        toast({
          variant: "destructive",
          title: "Import failed",
          description: json?.error || "See errors below.",
        });
      }
    } catch (err) {
      console.error(err);
      setUploadResult({
        inserted: 0,
        errors: [{ row: -1, error: "Upload failed" }],
      });
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "Could not contact the server.",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // export
  const onExportClick = () => {
    // Streamed download — keep it simple, just hit the endpoint
    window.location.href = "/api/companies/export";
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
  const openContactsModal = async (company_id: string) => {
    setSelectedCompanyId(company_id);
    setContactsModalOpen(true);
    setContactsLoading(true);
    setContactsError(null);
    setCompanyContacts([]);
    setSelectedCompanyName("");

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

  // table data mapping
  const tableData = currentRows.map((r) => ({
    ...(isAdmin
      ? {
          Select: (
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
          ),
        }
      : {}),
    name: (
      <button
        onClick={() => openCompanyModal(r.company_id)}
        className="text-emerald-400 hover:underline"
        title="View company details"
      >
        {r.name}
      </button>
    ),
    companyType: r.companyType || "—",
    // Header reads "Region"; backed by companies.meta.city_regency.
    region: r.city_regency || "—",
    location: r.location || "—",
    contacts: (
      <button
        onClick={() => openContactsModal(r.company_id)}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs"
        title="View unlocked contacts"
      >
        View ({r.contacts})
      </button>
    ),
    Actions: (
      <button
        onClick={() => openCompanyEdit(r)}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
        title="Edit company details"
      >
        <Pencil className="w-3.5 h-3.5" /> Edit
      </button>
    ),
  }));

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
      "email_general",
      "linkedin",
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
          title="Export your companies as CSV"
        >
          <Download className="w-4 h-4" />
          Export
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
              placeholder="Search company, type, size, or location…"
              aria-label="Search companies"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            />
          </div>

          {/* type */}
          <div className="md:col-span-2">
            <label className="text-xs text-gray-400 block mb-1">
              Company Type
            </label>
            <select
              value={filters.companyType}
              onChange={(e) =>
                setFilters((f) => ({ ...f, companyType: e.target.value }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            >
              <option value="">All</option>
              {companyTypeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* country */}
          <div className="md:col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Country</label>
            <select
              value={filters.country}
              onChange={(e) =>
                setFilters((f) => ({ ...f, country: e.target.value }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            >
              <option value="">All</option>
              {countryOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* segment — input for "+ new segment" is moved out of this cell so
              the Segment column stays the same height as its neighbours. */}
          <div className="md:col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Segment</label>
            <select
              value={filters.segment}
              onChange={(e) =>
                setFilters((f) => ({ ...f, segment: e.target.value }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 hover:border-gray-600 transition-colors"
            >
              <option value="">All segments</option>
              {segmentOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
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
            Parsed: <b>{uploadResult.parsed ?? 0}</b> • Valid:{" "}
            <b>{uploadResult.valid ?? 0}</b> • Inserted/updated:{" "}
            <b>{uploadResult.inserted ?? 0}</b>
            {uploadResult.dryRun ? (
              <span className="ml-2 italic text-gray-400">(dry run)</span>
            ) : null}
          </div>
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
          <Table headers={headers} data={tableData} />

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
          <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900">
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
                {segmentOptions.length > 0 ? (
                  <select
                    value={editCompanyForm.segment}
                    onChange={(e) => setEditCompanyForm((f) => ({ ...f, segment: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                  >
                    <option value="">—</option>
                    {segmentOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={editCompanyForm.segment}
                    onChange={(e) => setEditCompanyForm((f) => ({ ...f, segment: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                  />
                )}
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
                <label className="text-xs text-gray-400 block mb-1">Phone</label>
                <input
                  type="tel"
                  value={editCompanyForm.phone}
                  onChange={(e) => setEditCompanyForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+1 555 0100"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300"
                />
              </div>
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
                    companyFull.website ? (
                      <a
                        className="text-emerald-400 hover:underline"
                        href={companyFull.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {companyFull.website}
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
                    companyFull.linkedin ? (
                      <a
                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                        href={companyFull.linkedin}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Linkedin className="w-4 h-4" />
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
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-gray-700">
                        <th className="py-2 pr-4">Name</th>
                        <th className="py-2 pr-4">Title</th>
                        <th className="py-2 pr-4">Email</th>
                        <th className="py-2 pr-4">Phone</th>
                        <th className="py-2 pr-4">Social</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyContacts.map((c) => (
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
                        </tr>
                      ))}
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
    notes: string;
    company_profile: string;
    financial_reports: string;
    forecast_value: string;
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
        notes: "",
        company_profile: "",
        financial_reports: "",
        forecast_value: "",
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
                <input
                  className={fieldCls}
                  value={form.phone_main}
                  onChange={(e) =>
                    setForm({ ...form, phone_main: e.target.value })
                  }
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
