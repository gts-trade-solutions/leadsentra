"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ensureEmailHtml } from "@/lib/emailTracking";
import {
  ArrowLeft,
  Mail,
  Search,
  ShieldCheck,
  ShieldAlert,
  RefreshCcw,
  Send,
  Save,
  Calendar,
  AlertTriangle,
  Eye,
  Shield,
  ChevronDown,
  Settings2,
  Upload,
  FileSpreadsheet,
  X,
} from "lucide-react";
import SenderManageDrawer from "@/components/SenderVerifyDrawer";
import MultiSelectFilter from "@/components/MultiSelectFilter";
import RichTextEditor from "@/components/RichTextEditor";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import WalletBadge from "@/components/WalletBadge";
import { useOptionalAuth } from "@/components/AuthProvider";
import { useJobs } from "@/components/JobsProvider";
import {
  checkEmailStatus,
  listIdentities,
  type EmailIdentityRow,
} from "@/lib/sender";
import { toast } from "@/hooks/use-toast";

type RecipientRecord = { contact_id: string; contact_name: string | null; email: string };
type SelectionMode = "all" | "filtered" | "selected" | "uploaded" | "company_inboxes";

/** Result of POST /api/campaigns/recipients/parse. */
type UploadResult = {
  emails: string[];
  total: number;
  invalid: number;
  duplicates: number;
  invalidSamples: string[];
  truncated: boolean;
  column: string | null;
  maxEmails: number;
};

export default function NewCampaign() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useOptionalAuth();
  const isStaff = user?.role === "admin" || user?.role === "moderator";
  const { startSend } = useJobs();
  // Admin compose mode: ?admin=1 (only honored for staff).  Sends to EVERY
  // contact with an email (ignores unlocks) and skips credit charging.
  const adminMode = isStaff && searchParams?.get("admin") === "1";

  // Sender state — multi-identity "Send from" picker.
  const [mySender, setMySender] = useState<EmailIdentityRow | null>(null);
  const [identities, setIdentities] = useState<EmailIdentityRow[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string | null>(null);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [verStatus, setVerStatus] = useState<
    "idle" | "pending" | "verified" | "failed" | "error"
  >("idle");
  const selectedIdentity =
    identities.find((i) => i.id === selectedSenderId) ?? null;
  // The selected sender is what actually sends, so verification is judged off
  // it.  Falls back to the legacy single-sender status while identities load.
  const isVerified = selectedIdentity
    ? selectedIdentity.status === "verified"
    : (verStatus !== "idle" ? verStatus : (mySender?.status as any)) === "verified";
  // Mirrors selectedSenderId so loadIdentities can read the current selection
  // without re-creating the callback on every selection change.
  const selectedSenderIdRef = useRef<string | null>(null);

  // Apply a chosen identity to the active From email + name (drives the send,
  // the diagnostics panel, and the free-provider spam warning).
  const selectSender = useCallback((row: EmailIdentityRow | null) => {
    selectedSenderIdRef.current = row?.id ?? null;
    setSelectedSenderId(row?.id ?? null);
    setFromEmail(row?.email ?? "");
    setFromName((row?.display_name ?? "") || "");
    if (row?.status) setVerStatus(row.status as any);
  }, []);

  // Load every sender identity and auto-select the default (or first verified),
  // preserving the current/preferred selection when it still exists.
  const loadIdentities = useCallback(
    async (preferId?: string) => {
      try {
        const rows = await listIdentities();
        setIdentities(rows);
        setMySender(rows[0] ?? null);
        const prev = selectedSenderIdRef.current;
        const wanted =
          (preferId && rows.find((r) => r.id === preferId)) ||
          (prev && rows.find((r) => r.id === prev)) ||
          rows.find((r) => Number(r.is_default) === 1 && r.status === "verified") ||
          rows.find((r) => r.status === "verified") ||
          rows[0] ||
          null;
        selectSender(wanted);
        return rows;
      } catch {
        return [] as EmailIdentityRow[];
      }
    },
    [selectSender]
  );

  // Campaign content
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  // "Reduce promotional signals" — drop tracking pixel/link-redirects + bulk
  // headers to aim for Gmail's Primary tab (loses open/click analytics).
  const [lowSignal, setLowSignal] = useState(false);

  // Audience picker — server-side paginated.  We never load all contacts
  // into memory; just one page of search results + the total count.
  const [unlockedTotal, setUnlockedTotal] = useState<number>(0);
  // Used only in admin compose mode (sends to every contact regardless of unlock).
  const [allContactsTotal, setAllContactsTotal] = useState<number>(0);
  const [filteredTotal, setFilteredTotal] = useState<number>(0);
  const [visible, setVisible] = useState<RecipientRecord[]>([]);
  const PAGE_SIZE = 50;
  const [pageOffset, setPageOffset] = useState(0);
  const [recLoading, setRecLoading] = useState(false);
  const [recSearch, setRecSearch] = useState("");
  const [mode, setMode] = useState<SelectionMode>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedHydrated, setSelectedHydrated] = useState<RecipientRecord[]>([]);
  const [selectedHydrating, setSelectedHydrating] = useState(false);

  // Wallet
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);

  // Send options
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>("");

  // Send confirm
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendConfirmText, setSendConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  // Which wizard step is on screen.  1 = Who, 2 = Write, 3 = Review.
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Message editing.  "text" is the default: people type a normal message and
  // ensureEmailHtml() turns it into clean formatted HTML on send.  "html" keeps
  // the raw editor for anyone pasting a designed template.
  const [contentMode, setContentMode] = useState<"text" | "html">("text");
  // Preview renders inside an iframe with srcDoc so the campaign's HTML is
  // fully isolated from the app's styles — exactly what the recipient's mail
  // client will render.
  const [editorView, setEditorView] = useState<"code" | "preview">("code");

  // Deliverability diagnostics — score + per-check findings.
  const [diag, setDiag] = useState<{
    fromEmail: string;
    findings: Array<{ level: "ok" | "warn" | "fail"; title: string; detail: string; weight: number }>;
    score: number;
    maxScore: number;
    percent: number;
  } | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  // Pre-flight: how many of the chosen recipients will actually be sent
  // (i.e. excluding addresses already on the suppression list).
  const [preflight, setPreflight] = useState<{
    total: number;
    willSend: number;
    suppressed: number;
    suppressedEmails: string[];
  } | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  // Structured audience filters mirroring the Contacts page (segment / country
  // / company).  Combine with `mode: "filtered"` to narrow the send audience.
  const [filterSegments, setFilterSegments] = useState<string[]>([]);
  const [filterCountries, setFilterCountries] = useState<string[]>([]);
  const [filterCompanyTypes, setFilterCompanyTypes] = useState<string[]>([]);
  const [filterCompanyIds, setFilterCompanyIds] = useState<string[]>([]);
  // Department targeting — set by the Catalogues & Offers "Send" hand-off
  // (e.g. Race Innovations › LBI). Applied to 'all' and 'filtered' modes.
  const [filterDepartment, setFilterDepartment] = useState("");
  // Friendly label for the catalogue prefill banner (company › department).
  const [catalogueTarget, setCatalogueTarget] = useState<string | null>(null);
  // Catalogue/Offer sends target 'lead' contacts only. Regular campaigns leave
  // this false and reach all contacts, exactly as before.
  const [leadsOnly, setLeadsOnly] = useState(false);
  // Also mail each company's general inbox (info@, sales@) alongside the named
  // contacts. Off by default — it changes who gets the mail, and the credit cost.
  const [includeCompanyEmails, setIncludeCompanyEmails] = useState(false);
  const [segmentOptions, setSegmentOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [companyTypeOptions, setCompanyTypeOptions] = useState<string[]>([]);
  const [companyOptions, setCompanyOptions] = useState<{ company_id: string; name: string }[]>([]);
  // Company is filtered by id but displayed by name, so the picker takes
  // {value,label} pairs rather than plain strings.
  const companyChoices = useMemo(
    () => companyOptions.map((c) => ({ value: c.company_id, label: c.name })),
    [companyOptions]
  );

  // HTML template upload — drop in a designed .html file instead of writing one.
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const [templateName, setTemplateName] = useState<string>("");

  // Test send — mail the draft to yourself before the real thing.
  const [testTo, setTestTo] = useState<string>("");
  const [testBusy, setTestBusy] = useState(false);
  const [testSentTo, setTestSentTo] = useState<string | null>(null);

  /** Reads an uploaded .html file into the body, honouring its encoding. */
  async function handleTemplateUpload(file: File) {
    const MAX_BYTES = 2 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast({ variant: "destructive", title: "File too large", description: "HTML templates are limited to 2 MB." });
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      // Same encoding lesson as the CSV importer: a BOM settles it, otherwise
      // try strict UTF-8 and fall back to the Windows codepage — guessing wrong
      // is what turns accented characters into mojibake.
      let text: string;
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        text = new TextDecoder("utf-8").decode(buf.subarray(3));
      } else {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          text = new TextDecoder("windows-1252").decode(buf);
        }
      }
      // Scripts never run in a mail client and would only be a hazard in our
      // own preview, so strip them on the way in.
      const cleaned = text.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
      if (!cleaned.trim()) {
        toast({ variant: "destructive", title: "That file is empty" });
        return;
      }
      setContent(cleaned);
      setContentMode("html");
      setEditorView("preview");
      setTemplateName(file.name);
      toast({
        title: "Template loaded",
        description: `${file.name} · ${(file.size / 1024).toFixed(0)} KB. Showing the preview.`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not read that file", description: e?.message || "" });
    } finally {
      if (templateInputRef.current) templateInputRef.current.value = "";
    }
  }

  /** Sends the draft to one address without creating a campaign. */
  async function sendTestEmail() {
    if (!subject.trim() || !content.trim()) {
      toast({ variant: "destructive", title: "Add a subject and message first" });
      return;
    }
    setTestBusy(true);
    setTestSentTo(null);
    try {
      const res = await fetch("/api/campaigns/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          to: testTo.trim() || undefined,
          subject,
          html: content,
          from_email: fromEmail || undefined,
          from_name: fromName || undefined,
          low_signal: lowSignal,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not send the test");
      setTestSentTo(json.to);
      toast({ title: "Test sent", description: `Check ${json.to} — it arrives with a [TEST] subject.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Test send failed", description: e?.message || "" });
    } finally {
      setTestBusy(false);
    }
  }

  // Uploaded recipient list — a one-off audience that doesn't touch Contacts.
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadName, setUploadName] = useState<string>("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadedEmails = uploadResult?.emails ?? [];

  // Filter dropdown loader. Extracted as a useCallback so we can refresh
  // these lists whenever the user returns to this page (after adding a
  // company / contact elsewhere) — previously it only ran once on mount
  // and newly added rows didn't appear in the dropdowns.
  const refreshFilterOptions = useCallback(async () => {
    try {
      const [segResp, compResp, vocabResp] = await Promise.all([
        fetch("/api/companies/segments", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/companies", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/companies/vocab", { credentials: "same-origin", cache: "no-store" }),
      ]);
      const segJson = await segResp.json().catch(() => ({}));
      const compJson = await compResp.json().catch(() => ({}));
      const vocabJson = await vocabResp.json().catch(() => ({}));
      setSegmentOptions(Array.isArray(segJson?.segments) ? segJson.segments : []);
      const companies = Array.isArray(compJson?.data) ? compJson.data : [];
      setCompanyOptions(
        companies
          .map((c: any) => ({ company_id: c.company_id, name: c.name || c.company_name || c.company_id }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name))
      );
      const countries = Array.from(
        new Set<string>(
          companies
            .map((c: any) => String(c.country || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      setCountryOptions(countries);

      // Company type, the way the Companies page builds the same dropdown:
      // the values actually stored, narrowed to the approved vocabulary so a
      // typo imported once doesn't become a permanent filter option.
      //
      // Narrowed only while something survives it. A vocabulary listing types
      // nobody is filed under — seeded from a canonical list, or written before
      // the data it describes — would otherwise empty the dropdown completely
      // and hide every type there is something to filter by. An unrecognised
      // value on a thousand companies is not a typo, whatever the list says.
      const approved: string[] = Array.isArray(vocabJson?.terms?.company_type)
        ? vocabJson.terms.company_type
        : [];
      const approvedKeys = new Set(approved.map((t) => t.toLowerCase()));
      const stored = Array.from(
        new Set<string>(
          companies
            .map((c: any) => String(c.company_type || c.industry || "").trim())
            .filter(Boolean)
        )
      );
      const narrowed = stored.filter((t) => approvedKeys.has(t.toLowerCase()));
      setCompanyTypeOptions(
        (narrowed.length ? narrowed : stored).sort((a, b) => a.localeCompare(b))
      );
    } catch {
      /* leave dropdowns empty on failure */
    }
  }, []);

  useEffect(() => {
    refreshFilterOptions();
  }, [refreshFilterOptions]);

  // Refresh filter dropdowns + recipient list whenever the user returns to
  // this tab/page. Catches the common flow of "add contact on /contacts →
  // come back to /campaigns/new and expect the new row to be there".
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        refreshFilterOptions();
        loadCount();
        if (mode !== "all" && mode !== "uploaded" && mode !== "company_inboxes") {
          loadPage(0, recSearch.trim().toLowerCase(), true);
        }
      }
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recSearch]);

  // Re-run deliverability diagnostics whenever the sender changes.  The
  // server-side endpoint returns a list of pass/warn/fail findings + a score.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const u = new URL("/api/email/diagnostics", window.location.origin);
        if (fromEmail) u.searchParams.set("from", fromEmail);
        const r = await fetch(u.toString(), { credentials: "same-origin", cache: "no-store" });
        if (r.ok) setDiag(await r.json());
      } catch { /* ignore — diagnostic UI is non-critical */ }
    }, 300);
    return () => clearTimeout(handle);
  }, [fromEmail]);

  // ---- lifecycle ----
  useEffect(() => {
    (async () => {
      await loadIdentities();
      await refreshCredits();
      await loadCount();
      if (adminMode) await loadAllContactsCount();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMode]);

  // Catalogue/Offer hand-off: the Catalogues & Offers page stashes the chosen
  // item's content + targeting in sessionStorage, then navigates here. We read
  // it once on mount to prefill the composer, then clear it so a refresh won't
  // re-apply it.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("leadsentra:catalogue_send");
      if (raw) sessionStorage.removeItem("leadsentra:catalogue_send");
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const h = JSON.parse(raw);
      if (h?.title) setCampaignName(String(h.title));
      if (h?.subject) setSubject(String(h.subject));
      if (h?.html) {
        setContent(String(h.html));
        if (looksLikeHtml(String(h.html))) setContentMode("html");
      }
      // This is a Catalogues & Offers send — restrict the audience to leads.
      setLeadsOnly(true);
      const companyId = String(h?.company_id || "");
      const department = String(h?.department || "");
      if (companyId) {
        // Target this company (and department, if any).
        setMode("filtered");
        setFilterCompanyIds([companyId]);
        if (department) setFilterDepartment(department);
        setCatalogueTarget(
          `${h?.company_name || "Selected company"}${department ? ` › ${department}` : ""}`
        );
      } else {
        // "All companies (overall)" — send to everyone.
        setMode("all");
        setCatalogueTarget("All companies (overall)");
      }
    } catch {
      /* malformed hand-off — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-poll SES while the sender is pending — covers the case where the user
  // clicks the AWS verification link in another tab and returns to this page.
  // Silent: no toasts, no busy flag.  Stops as soon as we observe `verified`.
  useEffect(() => {
    if (isVerified) return;
    if (!selectedSenderId && !fromEmail) return;

    let cancelled = false;

    async function silentPoll() {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      try {
        const args = selectedSenderId ? { identityId: selectedSenderId } : { email: fromEmail };
        const resp = await checkEmailStatus(args);
        if (cancelled) return;
        setVerStatus(resp.status);
        if (resp.status === "verified") {
          if (!cancelled) {
            await loadIdentities(selectedSenderId ?? undefined);
            toast({ title: "Sender verified" });
          }
        }
      } catch { /* ignore — periodic poll, transient errors are fine */ }
    }

    // Poll immediately, then every 4s.
    silentPoll();
    const id = setInterval(silentPoll, 4000);
    function onFocus() { silentPoll(); }
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerified, fromEmail, selectedSenderId]);

  async function refreshCredits() {
    try {
      const res = await fetch("/api/wallet", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      setAvailableCredits(typeof data?.balance === "number" ? data.balance : 0);
    } catch {
      setAvailableCredits(0);
    }
  }

  // Lightweight: just fetches the COUNT of the user's unlocked contacts,
  // honoring the current structured filters (segment / country / company).
  async function loadCount() {
    try {
      const u = new URL("/api/contacts/unlocked", window.location.origin);
      u.searchParams.set("count", "only");
      if (filterDepartment) u.searchParams.set("department", filterDepartment);
      if (leadsOnly)        u.searchParams.set("leads_only", "1");
      // Multi-select: append each filter once per selected value.
      filterSegments.forEach((s) => u.searchParams.append("segment", s));
      filterCountries.forEach((c) => u.searchParams.append("country", c));
      filterCompanyTypes.forEach((t) => u.searchParams.append("company_type", t));
      filterCompanyIds.forEach((id) => u.searchParams.append("company_id", id));
      const res = await fetch(u.toString(), { credentials: "same-origin", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setUnlockedTotal(Number(data?.total || 0));
    } catch {
      setUnlockedTotal(0);
    }
  }

  // Admin compose audience count: every contact with a valid email, regardless of unlock.
  // Backed by /api/admin/stats which already returns global counts cheaply.
  async function loadAllContactsCount() {
    try {
      const res = await fetch("/api/admin/stats", { credentials: "same-origin", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const stats = data?.stats || {};
      setAllContactsTotal(Number(stats.contacts_with_email ?? stats.contacts ?? 0));
    } catch {
      setAllContactsTotal(0);
    }
  }

  // Paginated, server-side search.  Only fetches one page (50 rows) at a time.
  // Honors the structured filters (segment / country / company) so the audience
  // picker reflects what the backend will actually send to.
  const loadPage = useCallback(
    async (offset: number, q: string, replace: boolean) => {
      setRecLoading(true);
      try {
        const url = new URL("/api/contacts/unlocked", window.location.origin);
        url.searchParams.set("limit", String(PAGE_SIZE));
        url.searchParams.set("offset", String(offset));
        if (q) url.searchParams.set("q", q);
        if (filterDepartment) url.searchParams.set("department", filterDepartment);
        if (leadsOnly)        url.searchParams.set("leads_only", "1");
        filterSegments.forEach((s) => url.searchParams.append("segment", s));
        filterCountries.forEach((c) => url.searchParams.append("country", c));
        filterCompanyTypes.forEach((t) => url.searchParams.append("company_type", t));
        filterCompanyIds.forEach((id) => url.searchParams.append("company_id", id));
        const res = await fetch(url.toString(), { credentials: "same-origin", cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const list: any[] = Array.isArray(data?.contacts) ? data.contacts : [];
        const rows: RecipientRecord[] = list.map((r) => ({
          contact_id: r.contact_id,
          contact_name: r.contact_name,
          email: r.email,
        }));
        setFilteredTotal(Number(data?.total || 0));
        setVisible((prev) => (replace ? rows : [...prev, ...rows]));
      } finally {
        setRecLoading(false);
      }
    },
    [filterSegments, filterCountries, filterCompanyTypes, filterCompanyIds, filterDepartment, leadsOnly]
  );

  // Reload when search, mode, or any structured filter changes.
  useEffect(() => {
    // "uploaded" has no contact list to page through — the file IS the audience.
    // Neither does "company_inboxes": its audience is companies, not people.
    if (mode === "all" || mode === "uploaded" || mode === "company_inboxes") {
      // Refresh the count to reflect the current filter set even in "all" mode.
      setVisible([]);
      setPageOffset(0);
      if (mode === "all") loadCount();
      return;
    }
    const t = setTimeout(() => {
      setPageOffset(0);
      loadPage(0, recSearch.trim().toLowerCase(), true);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recSearch, loadPage, filterSegments, filterCountries, filterCompanyTypes, filterCompanyIds, filterDepartment]);

  // Hydrate names/emails for the chips shown in "Selected" mode.
  useEffect(() => {
    if (mode !== "selected") return;
    const ids = Array.from(selectedIds);
    if (!ids.length) { setSelectedHydrated([]); return; }

    // Only re-fetch when ids change in a way the current hydrated set doesn't cover.
    const have = new Set(selectedHydrated.map((r) => r.contact_id));
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) return;

    setSelectedHydrating(true);
    fetch("/api/contacts/unlocked/by-ids", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ids }),
    })
      .then((r) => r.json())
      .then((d) => {
        const rows: RecipientRecord[] = Array.isArray(d?.contacts) ? d.contacts : [];
        setSelectedHydrated(rows);
      })
      .catch(() => {})
      .finally(() => setSelectedHydrating(false));
  }, [mode, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced pre-flight: how many of the chosen recipients will the server
  // actually deliver to (i.e. NOT already on the suppression list)?  We
  // re-run this whenever the audience changes so the user sees the truthful
  // count + a "X bounced/suppressed will be skipped" badge.
  useEffect(() => {
    const handle = setTimeout(async () => {
      // Don't bother for empty/selected-with-no-picks, or an empty upload.
      if (!adminMode && mode === "selected" && selectedIds.size === 0) {
        setPreflight({ total: 0, willSend: 0, suppressed: 0, suppressedEmails: [] });
        return;
      }
      if (!adminMode && mode === "uploaded" && uploadedEmails.length === 0) {
        setPreflight({ total: 0, willSend: 0, suppressed: 0, suppressedEmails: [] });
        return;
      }
      setPreflightLoading(true);
      try {
        const r = await fetch("/api/campaigns/preflight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ audience: buildAudience() }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) setPreflight(j);
        else setPreflight(null);
      } catch {
        setPreflight(null);
      } finally {
        setPreflightLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedIds, recSearch, adminMode, allContactsTotal, unlockedTotal, filteredTotal, filterSegments, filterCountries, filterCompanyTypes, filterCompanyIds, filterDepartment, uploadedEmails.length, includeCompanyEmails]);

  // Contact-side count, from the same counters the audience picker uses.
  const contactsToSend = adminMode
    ? allContactsTotal
    : mode === "selected" ? selectedIds.size
    : mode === "uploaded" ? uploadedEmails.length
    // Companies, not contacts: no local counter knows this one. The preflight
    // total takes over below as soon as it lands.
    : mode === "company_inboxes" ? 0
    : mode === "filtered" ? filteredTotal
    : unlockedTotal;

  // Prefer the preflight total whenever it has loaded: it is the server's own
  // answer, resolved with the same SQL the send uses.
  //
  // The counters above count contact ROWS, but a campaign creates one row per
  // distinct EMAIL — two contacts sharing an address are one recipient. So the
  // header used to overstate the audience (and the credit cost with it), and
  // it had no way at all to know about company inboxes. Using the preflight
  // figure makes the number the one that will actually be sent.
  const recipientsToSend = preflight ? preflight.total : contactsToSend;

  // Pricing v2: 1 credit per 50 recipients (rounded up).  Keep this in sync
  // with EMAIL_BATCH_SIZE in /api/campaigns/[id]/send/route.ts.
  // Staff (admin/moderator) never get charged — UI mirrors that.
  const EMAIL_BATCH_SIZE = 50;
  const costInCredits = isStaff
    ? 0
    : recipientsToSend > 0
    ? Math.ceil(recipientsToSend / EMAIL_BATCH_SIZE)
    : 0;
  const canAfford = isStaff || (availableCredits ?? 0) >= costInCredits;

  // Build the audience descriptor for the backend.  Critically: we never
  // ship a 4000-element array of contact_ids — the server resolves "all"
  // and "filtered" via SQL.
  function buildAudience(): {
    mode: SelectionMode | "admin_all";
    q?: string;
    contact_ids?: string[];
    emails?: string[];
    segments?: string[];
    countries?: string[];
    company_types?: string[];
    company_ids?: string[];
    department?: string;
    leads_only?: boolean;
    include_company_emails?: boolean;
  } {
    // Catalogue/Offer sends restrict the audience to 'lead' contacts; regular
    // campaigns omit the flag and reach all contacts.
    const leadFlag = leadsOnly ? { leads_only: true } : {};
    const companyFlag = includeCompanyEmails ? { include_company_emails: true } : {};
    if (adminMode) {
      // Server checks staff role and downgrades to 'all' for non-staff.
      return { mode: "admin_all", ...leadFlag };
    }
    // Structured filters apply to both 'all' and 'filtered' modes.  All three
    // are arrays so one campaign can target several segments / countries /
    // companies at once.
    const filters: Record<string, any> = {};
    if (filterSegments.length)      filters.segments    = filterSegments;
    if (filterCountries.length)     filters.countries   = filterCountries;
    if (filterCompanyTypes.length)  filters.company_types = filterCompanyTypes;
    if (filterCompanyIds.length)    filters.company_ids = filterCompanyIds;
    if (filterDepartment)           filters.department  = filterDepartment;

    if (mode === "uploaded") {
      // A one-off list — no contact/unlock/filter resolution applies to it.
      // An uploaded list has no companies behind it, so the flag doesn't apply.
      return { mode: "uploaded", emails: uploadedEmails, ...leadFlag };
    }
    if (mode === "selected") {
      return { mode: "selected", contact_ids: Array.from(selectedIds), ...leadFlag, ...companyFlag };
    }
    if (mode === "filtered") {
      return { mode: "filtered", q: recSearch.trim().toLowerCase() || undefined, ...filters, ...leadFlag, ...companyFlag };
    }
    if (mode === "company_inboxes") {
      // Company addresses, so no unlock or contact_type filtering applies, and
      // neither does companyFlag — adding company inboxes to company inboxes
      // is what this mode already is.
      return { mode: "company_inboxes", q: recSearch.trim().toLowerCase() || undefined, ...filters };
    }
    return { mode: "all", ...filters, ...leadFlag, ...companyFlag };
  }

  /** Sends the chosen file to the parser and adopts the result as the audience. */
  async function handleUpload(file: File) {
    setUploadBusy(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/campaigns/recipients/parse", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not read that file");
      if (!json.total) {
        throw new Error("No valid email addresses found in that file");
      }
      setUploadResult(json as UploadResult);
      setUploadName(file.name);
      setMode("uploaded");
      toast({
        title: `${Number(json.total).toLocaleString()} recipients loaded`,
        description: `From ${file.name}${json.duplicates ? ` · ${json.duplicates} duplicate${json.duplicates === 1 ? "" : "s"} removed` : ""}`,
      });
    } catch (e: any) {
      setUploadResult(null);
      setUploadName("");
      setUploadError(e?.message || "Upload failed");
    } finally {
      setUploadBusy(false);
      // Let the same file be re-picked after a failure.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function clearUpload() {
    setUploadResult(null);
    setUploadName("");
    setUploadError(null);
    if (mode === "uploaded") setMode("all");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function loadMore() {
    const next = pageOffset + PAGE_SIZE;
    setPageOffset(next);
    loadPage(next, recSearch.trim().toLowerCase(), false);
  }

  async function submitCampaign(
    status: "draft" | "sending" | "scheduled",
    scheduledAtIso?: string
  ) {
    setBusy(true);
    try {
      const payload: any = {
        name: campaignName || "Untitled",
        subject,
        html: content,
        from_email: fromEmail,
        from_name: fromName || null,
        status,
        low_signal: lowSignal,
        audience: buildAudience(),
      };
      if (status === "scheduled") payload.scheduled_at = scheduledAtIso;

      const createResp = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const created = await createResp.json().catch(() => ({}));
      if (!createResp.ok) {
        if (createResp.status === 402) {
          toast({
            variant: "destructive",
            title: "Not enough credits",
            description: `You need ${created.required} credits to send to ${created.recipients} recipients (1 credit per ${created.batch_size}). Current balance: ${created.balance}.`,
          });
          return;
        }
        throw new Error(created?.error || "Create failed");
      }

      if (status === "sending" && created?.id) {
        // Register a job: the floating <JobsBar /> widget owns the actual
        // /send drain loop + progress polling.  We DON'T await the send here
        // so the user can immediately navigate around while it works.
        const totalRecipients = Number(created?.recipients_count ?? recipientsToSend) || recipientsToSend;
        startSend(
          created.id,
          campaignName || "Untitled",
          totalRecipients
        );
      }

      const suppCount = Number(created?.suppressed_count || 0);
      toast({
        title:
          status === "draft"
            ? "Draft saved"
            : status === "scheduled"
            ? `Scheduled for ${new Date(scheduledAtIso!).toLocaleString()}`
            : "Campaign sending in background",
        description:
          status === "sending"
            ? "Watch the progress widget in the bottom-right." +
              (suppCount ? `  ${suppCount} suppressed recipient${suppCount === 1 ? "" : "s"} skipped.` : "")
            : suppCount
            ? `${suppCount} suppressed recipient${suppCount === 1 ? "" : "s"} skipped`
            : undefined,
      });

      // Off to the tracking page (if we have an id) or list
      if (created?.id) router.push(`/portal/campaigns/${created.id}`);
      else router.push("/portal/campaigns");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Create failed", description: e?.message || "" });
    } finally {
      setBusy(false);
    }
  }

  // Template recall: when the user finishes typing a campaign name, look up the
  // most recent campaign they saved/sent under that exact name and offer to
  // reuse its subject + content.  If the subject/content fields are still empty
  // we fill them silently; if they already typed something we ask first so we
  // never clobber in-progress work.
  const lastTemplateLookup = useRef<string>("");
  async function loadTemplateForName() {
    const name = campaignName.trim();
    if (!name || name === lastTemplateLookup.current) return;
    lastTemplateLookup.current = name;
    try {
      const res = await fetch(
        `/api/campaigns/template?name=${encodeURIComponent(name)}`,
        { credentials: "same-origin", cache: "no-store" }
      );
      if (!res.ok) return;
      const { template } = await res.json().catch(() => ({ template: null }));
      if (!template) return;

      const hasWork = subject.trim() || content.trim();
      if (hasWork) {
        if (!confirm(`A saved template named "${name}" was found. Load its subject and content? This replaces what you've typed.`)) {
          return;
        }
      }
      setSubject(template.subject || "");
      setContent(template.html || "");
      // A saved template is usually real HTML — switch the editor so the user
      // sees markup in the markup editor rather than as literal text.
      if (looksLikeHtml(template.html || "")) setContentMode("html");
      toast({ title: "Template loaded", description: `Reused your saved "${name}" content.` });
    } catch {
      /* lookup is best-effort — ignore network errors */
    }
  }

  function saveDraft() {
    if (!campaignName.trim()) {
      toast({ variant: "destructive", title: "Name is required", description: "Give your campaign a name." });
      return;
    }
    submitCampaign("draft");
  }

  function requestSend() {
    if (!fromEmail) {
      toast({ variant: "destructive", title: "Sender required", description: "Verify a From address first." });
      return;
    }
    if (!isVerified) {
      toast({ variant: "destructive", title: "Sender not verified" });
      return;
    }
    if (recipientsToSend === 0) {
      toast({ variant: "destructive", title: "No recipients selected" });
      return;
    }
    if (!campaignName.trim() || !subject.trim() || !content.trim()) {
      toast({ variant: "destructive", title: "Missing fields", description: "Fill name, subject, and content." });
      return;
    }
    setSendConfirmText("");
    setShowSendConfirm(true);
  }

  function scheduleSend() {
    if (!scheduleAt) {
      toast({ variant: "destructive", title: "Pick a time" });
      return;
    }
    const t = new Date(scheduleAt).getTime();
    if (isNaN(t) || t < Date.now()) {
      toast({ variant: "destructive", title: "Schedule must be in the future" });
      return;
    }
    submitCampaign("scheduled", new Date(scheduleAt).toISOString());
  }

  // ---- Wizard ---------------------------------------------------------------
  // The old page put every control on screen at once — sender, content,
  // audience, filters, diagnostics, schedule — which is what made it hard to
  // approach. Same state and same submit path; it's just revealed one question
  // at a time now.
  const STEPS = [
    { n: 1 as const, title: "Who",    hint: "Pick who receives this" },
    { n: 2 as const, title: "Write",  hint: "Sender, subject, message" },
    { n: 3 as const, title: "Review", hint: "Check and send" },
  ];

  /** Why the user can't leave a step yet — null when the step is complete. */
  function blockerFor(s: 1 | 2 | 3): string | null {
    if (s === 1) {
      if (recipientsToSend === 0) {
        if (mode === "uploaded") return "Upload a file with at least one address";
        if (mode === "selected") return "Tick at least one person";
        if (mode === "company_inboxes") return "No company inboxes match those filters — widen them";
        return "This audience is empty — widen it or pick another option";
      }
      return null;
    }
    if (s === 2) {
      if (!fromEmail) return "Add a sender address to send from";
      if (!isVerified) return "This sender isn't verified yet";
      if (!campaignName.trim()) return "Give the campaign a name";
      if (!subject.trim()) return "Write a subject line";
      if (!content.trim()) return "Write a message";
      return null;
    }
    return null;
  }

  const stepBlocker = blockerFor(step);
  const canLeaveStep = stepBlocker === null;
  /** A step is reachable once every step before it is complete. */
  const canJumpTo = (target: 1 | 2 | 3) =>
    target <= step || STEPS.slice(0, target - 1).every((s) => blockerFor(s.n) === null);

  function goNext() {
    if (!canLeaveStep) {
      toast({ variant: "destructive", title: stepBlocker! });
      return;
    }
    setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s));
  }

  // Large sends ask the user to type SEND; small ones just confirm. Typing it
  // for a 12-person test was pure friction, but the safeguard still earns its
  // place when a slip costs thousands of emails and the credits behind them.
  const TYPE_TO_CONFIRM_THRESHOLD = 1000;
  const needsTypedConfirm = recipientsToSend >= TYPE_TO_CONFIRM_THRESHOLD;

  /** Human summary of the chosen audience, shown on the review step. */
  const audienceLabel = adminMode
    ? "Every contact with a valid email (admin bypass)"
    : mode === "uploaded"
    ? `${uploadedEmails.length.toLocaleString()} uploaded addresses from ${uploadName}`
    : mode === "selected"
    ? `${selectedIds.size.toLocaleString()} hand-picked ${selectedIds.size === 1 ? "person" : "people"}`
    : mode === "company_inboxes"
    ? `${(preflight?.total ?? 0).toLocaleString()} company inboxes (no named contacts)`
    : mode === "filtered"
    ? `${filteredTotal.toLocaleString()} matching your filters`
    : `Everyone — ${unlockedTotal.toLocaleString()} ${isStaff ? "contacts" : "unlocked contacts"}`;

  return (
    <AuthGuard>
      {/* pb-24 leaves room under the sticky bottom bar so the last card can
          scroll fully into view above it. */}
      <div className="space-y-5 pb-24">
        <SectionHeader
          title={adminMode ? "Admin compose" : "Create campaign"}
          description={
            adminMode
              ? "Sends to every contact regardless of unlock state. No credits charged."
              : "Three steps: choose who, write the email, then review and send."
          }
        >
          <WalletBadge />
          <Link
            href="/portal/campaigns"
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to campaigns
          </Link>
        </SectionHeader>

        {/* Progress. Clicking a completed step jumps back to it; steps ahead of
            the first incomplete one stay locked so you can't skip a decision. */}
        <ol className="flex items-stretch gap-2">
          {STEPS.map((s) => {
            const active = step === s.n;
            const done = s.n < step && blockerFor(s.n) === null;
            const reachable = canJumpTo(s.n);
            return (
              <li key={s.n} className="flex-1">
                <button
                  type="button"
                  onClick={() => reachable && setStep(s.n)}
                  disabled={!reachable}
                  aria-current={active ? "step" : undefined}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                    active
                      ? "border-emerald-600 bg-emerald-950/30"
                      : done
                      ? "border-gray-700 bg-gray-900 hover:border-gray-600"
                      : "border-gray-800 bg-gray-900/40"
                  } ${reachable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${
                        active
                          ? "bg-emerald-600 text-white"
                          : done
                          ? "bg-emerald-900/60 text-emerald-300"
                          : "bg-gray-800 text-gray-500"
                      }`}
                    >
                      {done ? "✓" : s.n}
                    </span>
                    <span
                      className={`text-sm font-medium truncate ${
                        active ? "text-white" : done ? "text-gray-200" : "text-gray-500"
                      }`}
                    >
                      {s.title}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate hidden sm:block">
                    {s.hint}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>

        {adminMode && (
          <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-100">
              <div className="font-semibold">Admin compose mode</div>
              <div className="text-amber-200/80 mt-0.5">
                You are sending as <b>staff</b>. This bypasses the unlock requirement,
                ignores the audience picker, and skips credit charging entirely.
                Suppressed addresses are still filtered out.
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 1 — WHO ================= */}
        {step === 1 && (
          <Card title="Who should get this?" icon={<Mail className="w-5 h-5 text-emerald-400" />}>
            {/* Catalogue/Offer hand-off banner. */}
            {catalogueTarget && (
              <div className="mb-3 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 flex items-center justify-between gap-3">
                <div className="text-sm text-emerald-100">
                  Prefilled from catalogue — targeting{" "}
                  <b className="text-white">{catalogueTarget}</b>
                  <span className="text-emerald-300/80"> · lead contacts only</span>
                </div>
                {filterDepartment && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterDepartment("");
                      setCatalogueTarget((t) => (t ? t.split(" › ")[0] : t));
                    }}
                    className="text-xs text-emerald-300 hover:text-emerald-200 underline whitespace-nowrap"
                  >
                    Send to whole company
                  </button>
                )}
              </div>
            )}

            {adminMode ? (
              <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5 text-sm text-amber-100">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-300" />
                  <span>
                    Sending to <b className="text-white">{allContactsTotal.toLocaleString()}</b>{" "}
                    contact{allContactsTotal === 1 ? "" : "s"} with a valid email.
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-200/70">
                  Audience picker is disabled in admin compose. Suppressed addresses are still filtered out.
                </p>
              </div>
            ) : (
              <>
                {/* The four ways to choose an audience, as cards rather than a
                    row of bare radios — each says what it does and how many
                    people it reaches, so the choice can be made without
                    scrolling to find the count. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <AudienceChoice
                    checked={mode === "all"}
                    onSelect={() => setMode("all")}
                    title="Everyone"
                    detail={`${unlockedTotal.toLocaleString()} ${isStaff ? "contacts" : "unlocked contacts"}`}
                    blurb="Your whole list. Simplest option."
                  />
                  <AudienceChoice
                    checked={mode === "filtered"}
                    onSelect={() => setMode("filtered")}
                    title="Narrow it down"
                    detail={mode === "filtered" ? `${filteredTotal.toLocaleString()} match` : "By segment, country, company"}
                    blurb="Filter by company details or search by name."
                  />
                  <AudienceChoice
                    checked={mode === "selected"}
                    onSelect={() => setMode("selected")}
                    title="Pick people"
                    detail={`${selectedIds.size.toLocaleString()} picked`}
                    blurb="Tick individual contacts from a list."
                  />
                  <AudienceChoice
                    checked={mode === "company_inboxes"}
                    onSelect={() => setMode("company_inboxes")}
                    title="Company inboxes"
                    detail={
                      mode === "company_inboxes" && preflight
                        ? `${preflight.total.toLocaleString()} inboxes`
                        : "info@, sales@ and the like"
                    }
                    blurb="Mail companies directly — no contacts needed."
                  />
                  <AudienceChoice
                    checked={mode === "uploaded"}
                    onSelect={() => uploadedEmails.length ? setMode("uploaded") : fileInputRef.current?.click()}
                    title="Upload a list"
                    detail={uploadedEmails.length ? `${uploadedEmails.length.toLocaleString()} addresses` : "CSV or Excel"}
                    blurb="Send to addresses that aren't in your contacts."
                  />
                </div>

                {/* Hidden input drives both the card above and the buttons below. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />

                {/* ---- Controls for the chosen option only ---- */}

                {mode === "filtered" && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <MultiSelectFilter
                        id="camp-type"
                        label="Company type"
                        options={companyTypeOptions}
                        selected={filterCompanyTypes}
                        onChange={setFilterCompanyTypes}
                        placeholder="All types"
                        searchPlaceholder="Search types…"
                      />
                      <MultiSelectFilter
                        id="camp-segment"
                        label="Segment"
                        options={segmentOptions}
                        selected={filterSegments}
                        onChange={setFilterSegments}
                        placeholder="All segments"
                        searchPlaceholder="Search segments…"
                      />
                      <MultiSelectFilter
                        id="camp-country"
                        label="Country"
                        options={countryOptions}
                        selected={filterCountries}
                        onChange={setFilterCountries}
                        placeholder="All countries"
                        searchPlaceholder="Search countries…"
                      />
                      <MultiSelectFilter
                        id="camp-company"
                        label="Company"
                        options={companyChoices}
                        selected={filterCompanyIds}
                        onChange={setFilterCompanyIds}
                        placeholder="All companies"
                        searchPlaceholder="Search companies…"
                      />
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setFilterSegments([]); setFilterCountries([]); setFilterCompanyTypes([]); setFilterCompanyIds([]); setFilterDepartment(""); setCatalogueTarget(null); }}
                          disabled={!filterSegments.length && !filterCountries.length && !filterCompanyTypes.length && filterCompanyIds.length === 0 && !filterDepartment}
                          className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600 disabled:opacity-50"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await refreshFilterOptions();
                            await loadCount();
                            loadPage(0, recSearch.trim().toLowerCase(), true);
                          }}
                          className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600"
                          title="Reload contacts and companies"
                        >
                          <RefreshCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="rec-search" className="block text-xs text-gray-400 mb-1">
                        Search by name or email (optional)
                      </label>
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                          id="rec-search"
                          type="text"
                          value={recSearch}
                          onChange={(e) => setRecSearch(e.target.value)}
                          placeholder="e.g. acme, priya@…"
                          className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                        />
                      </div>
                    </div>

                    <RecipientPreviewList
                      visible={visible}
                      recLoading={recLoading}
                      filteredTotal={filteredTotal}
                      onLoadMore={loadMore}
                      pageSize={PAGE_SIZE}
                      readOnly
                    />
                  </div>
                )}

                {mode === "company_inboxes" && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <MultiSelectFilter
                        id="camp-inbox-type"
                        label="Company type"
                        options={companyTypeOptions}
                        selected={filterCompanyTypes}
                        onChange={setFilterCompanyTypes}
                        placeholder="All types"
                        searchPlaceholder="Search types…"
                      />
                      <MultiSelectFilter
                        id="camp-inbox-segment"
                        label="Segment"
                        options={segmentOptions}
                        selected={filterSegments}
                        onChange={setFilterSegments}
                        placeholder="All segments"
                        searchPlaceholder="Search segments…"
                      />
                      <MultiSelectFilter
                        id="camp-inbox-country"
                        label="Country"
                        options={countryOptions}
                        selected={filterCountries}
                        onChange={setFilterCountries}
                        placeholder="All countries"
                        searchPlaceholder="Search countries…"
                      />
                      <MultiSelectFilter
                        id="camp-inbox-company"
                        label="Company"
                        options={companyChoices}
                        selected={filterCompanyIds}
                        onChange={setFilterCompanyIds}
                        placeholder="All companies"
                        searchPlaceholder="Search companies…"
                      />
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setFilterSegments([]); setFilterCountries([]); setFilterCompanyTypes([]); setFilterCompanyIds([]); }}
                          disabled={!filterSegments.length && !filterCountries.length && !filterCompanyTypes.length && !filterCompanyIds.length}
                          className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600 disabled:opacity-50"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => refreshFilterOptions()}
                          className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600"
                          title="Reload companies"
                        >
                          <RefreshCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="inbox-search" className="block text-xs text-gray-400 mb-1">
                        Search by company name or address (optional)
                      </label>
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                          id="inbox-search"
                          type="text"
                          value={recSearch}
                          onChange={(e) => setRecSearch(e.target.value)}
                          placeholder="e.g. acme, @acme.com"
                          className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                        />
                      </div>
                    </div>

                    {/* No per-address preview list. One company can hold three
                        addresses and two companies can share one, so only the
                        server knows what the filters add up to — that is the
                        preflight count, and showing a second guess beside it
                        would just be a number that disagrees. */}
                    <p className="text-xs text-gray-400">
                      {preflightLoading
                        ? "Counting company inboxes…"
                        : preflight
                        ? `${preflight.total.toLocaleString()} company ${preflight.total === 1 ? "inbox" : "inboxes"} to send to`
                        : "Narrow it down with the filters above, or send to every company you can see."}
                    </p>
                  </div>
                )}

                {mode === "selected" && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
                      <div>
                        <label htmlFor="rec-search-pick" className="block text-xs text-gray-400 mb-1">
                          Search contacts
                        </label>
                        <div className="relative">
                          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                          <input
                            id="rec-search-pick"
                            type="text"
                            value={recSearch}
                            onChange={(e) => setRecSearch(e.target.value)}
                            placeholder="name or email…"
                            className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set(visible.map((v) => v.contact_id)))}
                        className="h-[38px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 text-white text-sm whitespace-nowrap"
                        title="Selects only the rows visible below"
                      >
                        Select shown ({visible.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="h-[38px] px-3 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-200 text-sm whitespace-nowrap"
                        disabled={selectedIds.size === 0}
                      >
                        Clear ({selectedIds.size})
                      </button>
                    </div>

                    {selectedIds.size > 0 && (
                      <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-3">
                        <div className="text-xs text-emerald-200 mb-2">
                          {selectedIds.size.toLocaleString()} selected
                          {selectedHydrating && <span className="ml-2 text-gray-400">(loading details…)</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                          {selectedHydrated.slice(0, 200).map((r) => (
                            <span
                              key={r.contact_id}
                              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-200"
                              title={r.email}
                            >
                              <span className="truncate max-w-[180px]">{r.contact_name || r.email}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedIds((prev) => {
                                    const n = new Set(prev);
                                    n.delete(r.contact_id);
                                    return n;
                                  })
                                }
                                className="w-5 h-5 grid place-items-center rounded-full text-gray-500 hover:bg-gray-700 hover:text-white"
                                aria-label={`Remove ${r.contact_name || r.email}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {selectedHydrated.length > 200 && (
                            <span className="text-xs text-gray-400 self-center px-1">
                              + {selectedHydrated.length - 200} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <RecipientPreviewList
                      visible={visible}
                      recLoading={recLoading}
                      filteredTotal={filteredTotal}
                      onLoadMore={loadMore}
                      pageSize={PAGE_SIZE}
                      selectedIds={selectedIds}
                      onToggle={(id, on) =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                    />
                  </div>
                )}

                {mode === "uploaded" && (
                  <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                    {!uploadResult ? (
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="text-sm text-gray-300 min-w-0">
                          <div className="font-medium text-gray-200 flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                            Choose a CSV or Excel file
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Up to 50,000 addresses. We read the{" "}
                            <code className="text-gray-400">email</code> column (or scan every cell
                            if there isn&apos;t one), then drop invalid rows and duplicates. Used for
                            this campaign only — nothing is added to Contacts.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadBusy}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium whitespace-nowrap disabled:opacity-60"
                        >
                          <Upload className="w-4 h-4" />
                          {uploadBusy ? "Reading…" : "Choose file"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="text-sm text-gray-200 min-w-0">
                          <div className="font-medium flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="truncate">{uploadName}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            <b className="text-emerald-300">{uploadResult.total.toLocaleString()}</b>{" "}
                            valid address{uploadResult.total === 1 ? "" : "es"}
                            {uploadResult.column ? ` · from column "${uploadResult.column}"` : " · scanned all columns"}
                            {uploadResult.duplicates > 0 && ` · ${uploadResult.duplicates.toLocaleString()} duplicate${uploadResult.duplicates === 1 ? "" : "s"} removed`}
                            {uploadResult.invalid > 0 && (
                              <>
                                {" · "}
                                <span
                                  className="text-amber-300"
                                  title={uploadResult.invalidSamples.length ? `e.g. ${uploadResult.invalidSamples.join(", ")}` : ""}
                                >
                                  {uploadResult.invalid.toLocaleString()} skipped as invalid
                                </span>
                              </>
                            )}
                          </div>
                          {uploadResult.truncated && (
                            <div className="text-xs text-amber-300 mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Stopped at the {uploadResult.maxEmails.toLocaleString()}-address limit — the rest of the file was not read.
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5 max-h-20 overflow-auto">
                            {uploadedEmails.slice(0, 30).map((e) => (
                              <span
                                key={e}
                                className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300"
                              >
                                {e}
                              </span>
                            ))}
                            {uploadedEmails.length > 30 && (
                              <span className="text-xs text-gray-500 self-center px-1">
                                + {(uploadedEmails.length - 30).toLocaleString()} more
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadBusy}
                            className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600 disabled:opacity-60"
                          >
                            {uploadBusy ? "Reading…" : "Replace"}
                          </button>
                          <button
                            type="button"
                            onClick={clearUpload}
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 text-sm hover:border-gray-600"
                          >
                            <X className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                    {uploadError && (
                      <div className="mt-2 text-xs text-rose-300 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {uploadError}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Company inboxes. Campaign audiences are built from contacts, so
                without this the shared inbox — often the address that actually
                gets read — never receives the mail. Not offered for an uploaded
                list, which has no companies behind it. */}
            {mode !== "uploaded" && mode !== "company_inboxes" && (
              <label className="mt-3 flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCompanyEmails}
                  onChange={(e) => setIncludeCompanyEmails(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                />
                <span>
                  <span className="text-sm text-gray-200 block">
                    Also send to company email addresses
                  </span>
                  <span className="text-[11px] text-gray-500 block mt-0.5">
                    Adds the general inbox of every company in this audience
                    (info@, sales@ and any extras on the company record) on top
                    of the named contacts. Duplicates are removed, and each
                    extra address counts toward the recipient total and cost.
                  </span>
                </span>
              </label>
            )}

            {/* Running total for whatever is chosen above. */}
            <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-gray-300">
                Will send to{" "}
                <b className="text-white">{recipientsToSend.toLocaleString()}</b>{" "}
                {recipientsToSend === 1 ? "person" : "people"}
              </span>
              {preflight && preflight.suppressed > 0 ? (
                <span
                  className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-900/30 text-rose-200 border border-rose-700"
                  title={
                    preflight.suppressedEmails.length
                      ? "Skipped (suppressed): " + preflight.suppressedEmails.join(", ") +
                        (preflight.suppressed > preflight.suppressedEmails.length
                          ? ` and ${preflight.suppressed - preflight.suppressedEmails.length} more`
                          : "")
                      : ""
                  }
                >
                  <AlertTriangle className="w-3 h-3" />
                  {preflight.suppressed.toLocaleString()} bounced/unsubscribed will be skipped
                </span>
              ) : preflight && !preflightLoading && preflight.total > 0 ? (
                <span className="text-[11px] text-emerald-300/80">
                  No suppressed addresses in this audience
                </span>
              ) : null}
            </div>
          </Card>
        )}

        {/* ================= STEP 2 — WRITE ================= */}
        {step === 2 && (
          <>
            {/* Sending FROM a free provider fails DMARC at the receiver — shown
                right next to the sender picker where the fix is. */}
            {fromEmail && isFreeProviderSender(fromEmail) && (
              <div className="rounded-xl border border-rose-700/70 bg-rose-950/40 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-rose-100 min-w-0 flex-1">
                  <div className="font-semibold">Your mail will land in SPAM</div>
                  <div className="text-rose-200/90 mt-1">
                    You&apos;re sending from <b className="break-all">{fromEmail}</b>, a free email
                    provider ({fromEmail.split("@")[1]}). Gmail, Outlook and Yahoo reject or
                    spam-folder mail that claims to be from a free-provider address but didn&apos;t
                    come from their servers (DMARC). No header or content tweak fixes this.
                  </div>
                  <div className="text-rose-200/90 mt-2">
                    <b>Fix:</b> pick a sender on a domain you own, e.g.
                    <code className="mx-1 px-1 bg-rose-950/80 rounded">marketing@raceautoindia.com</code>.
                  </div>
                </div>
              </div>
            )}

            <Card title="Who it comes from" icon={<Mail className="w-5 h-5 text-emerald-400" />}>
              {identities.length === 0 ? (
                <div className="p-4 border border-gray-700 rounded-lg bg-gray-900/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-sm text-gray-300">
                    You haven&apos;t added a sender yet. Add and verify an email address to send from.
                  </div>
                  <button
                    type="button"
                    onClick={() => setManageOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium whitespace-nowrap"
                  >
                    <Mail className="w-4 h-4" />
                    Add sender
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="relative flex-1 min-w-0">
                    <label htmlFor="send-from" className="sr-only">Send from</label>
                    <select
                      id="send-from"
                      value={selectedSenderId ?? ""}
                      onChange={(e) => {
                        const row = identities.find((i) => i.id === e.target.value) ?? null;
                        selectSender(row);
                      }}
                      className="w-full appearance-none px-3 py-2 pr-9 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm"
                    >
                      {identities.map((i) => {
                        const name = (i.display_name ?? "").trim();
                        const label =
                          (name ? `"${name}" <${i.email}>` : i.email) +
                          (Number(i.is_default) === 1 ? " (default)" : "") +
                          (i.status === "verified" ? " ✓ verified" : ` — ${i.status}`);
                        return (
                          <option key={i.id} value={i.id} disabled={i.status !== "verified"}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  {isVerified ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-emerald-900/30 text-emerald-200 border border-emerald-700 whitespace-nowrap">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Verified
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-rose-900/30 text-rose-200 border border-rose-700 whitespace-nowrap"
                      title="This sender hasn't completed SES verification yet — campaigns won't send until it does."
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Not verified
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setManageOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 whitespace-nowrap"
                  >
                    <Settings2 className="w-4 h-4" />
                    Manage
                  </button>
                </div>
              )}
            </Card>

            <Card title="What it says" icon={<Eye className="w-5 h-5 text-emerald-400" />}>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="camp-name" className="block text-sm font-medium text-gray-300 mb-1">
                    Campaign name
                  </label>
                  <input
                    id="camp-name"
                    type="text"
                    placeholder="e.g. Q1 product launch"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    onBlur={loadTemplateForName}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Only you see this. Reuse a name you&apos;ve sent before and its content loads automatically.
                  </p>
                </div>
                <div>
                  <label htmlFor="camp-subject" className="block text-sm font-medium text-gray-300 mb-1">
                    Subject line
                  </label>
                  <input
                    id="camp-subject"
                    type="text"
                    placeholder="What recipients see in their inbox"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <label htmlFor="camp-content" className="block text-sm font-medium text-gray-300">
                      Message
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Drop in a designed .html file rather than pasting it
                          into the HTML tab. */}
                      <input
                        ref={templateInputRef}
                        type="file"
                        accept=".html,.htm,text/html"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleTemplateUpload(f);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => templateInputRef.current?.click()}
                        title="Load a designed HTML template from a file"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 text-xs hover:border-gray-600"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Upload HTML
                      </button>

                      {/* Write / HTML / Preview. "Write" is the formatting
                          editor — nobody should have to type markup to send an
                          email — with HTML kept as an escape hatch for pasting
                          a designed template. */}
                      <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 overflow-hidden text-xs">
                        <button
                          type="button"
                          onClick={() => { setContentMode("text"); setEditorView("code"); }}
                          className={`px-3 py-1.5 transition-colors ${
                            editorView === "code" && contentMode === "text"
                              ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-700"
                          }`}
                        >
                          Write
                        </button>
                        <button
                          type="button"
                          onClick={() => { setContentMode("html"); setEditorView("code"); }}
                          className={`px-3 py-1.5 transition-colors ${
                            editorView === "code" && contentMode === "html"
                              ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-700"
                          }`}
                          title="Edit the raw HTML"
                        >
                          HTML
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorView("preview")}
                          disabled={!content.trim()}
                          className={`px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            editorView === "preview" ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-700"
                          }`}
                          title={content.trim() ? "See what recipients will see" : "Write something first"}
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                  </div>

                  {editorView === "code" && contentMode === "text" ? (
                    <RichTextEditor
                      value={content}
                      onChange={setContent}
                      placeholder="Hi there,&#10;&#10;Write your message here — use the buttons above to format it."
                    />
                  ) : editorView === "code" ? (
                    <textarea
                      id="camp-content"
                      rows={14}
                      placeholder={'<p>Hi {{name}},</p>\n<p>Your message here…</p>\n<p><a href="{{unsubscribe_link}}">Unsubscribe</a></p>'}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 resize-y font-mono text-sm"
                    />
                  ) : (
                    <div className="rounded-lg border border-gray-700 bg-white overflow-hidden">
                      <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-xs text-gray-600 flex items-center justify-between">
                        <span>
                          <b>Preview:</b> {subject || <em className="text-gray-400">(no subject)</em>}
                        </span>
                        <span className="text-gray-500">From: {fromEmail || "—"}</span>
                      </div>
                      <iframe
                        title="Email preview"
                        sandbox=""
                        srcDoc={buildPreviewHtml(content)}
                        className="w-full bg-white"
                        style={{ height: 520, border: 0 }}
                      />
                    </div>
                  )}

                  <p className="mt-1 text-[11px] text-gray-500">
                    {templateName && (
                      <span className="text-emerald-400">Loaded {templateName} · </span>
                    )}
                    Use <code className="text-gray-400">{"{{unsubscribe_link}}"}</code> anywhere — it&apos;s
                    replaced per recipient. Pasted text keeps its formatting; Word and Google Docs
                    markup is cleaned up automatically.
                  </p>

                  {/* Send yourself a copy. The preview iframe shows the layout,
                      but only a real inbox shows how the recipient's client
                      actually renders it — which is where templates break. */}
                  <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                      <div className="flex-1 min-w-0">
                        <label htmlFor="test-to" className="block text-xs text-gray-400 mb-1">
                          Send a test copy to
                        </label>
                        <input
                          id="test-to"
                          type="email"
                          value={testTo}
                          onChange={(e) => setTestTo(e.target.value)}
                          placeholder={user?.email || "you@company.com"}
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={sendTestEmail}
                        disabled={testBusy || !subject.trim() || !content.trim()}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 border border-gray-700 text-gray-200 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        title={
                          subject.trim() && content.trim()
                            ? "Email this draft to yourself — no campaign is created, no credits are used"
                            : "Add a subject and message first"
                        }
                      >
                        <Send className="w-4 h-4" />
                        {testBusy ? "Sending…" : "Send test"}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      {testSentTo ? (
                        <span className="text-emerald-400">
                          Sent to {testSentTo} — look for the <b>[TEST]</b> subject.
                        </span>
                      ) : (
                        <>
                          Leave blank to send to yourself. No campaign is created and no credits are
                          charged. Open tracking is skipped on a test, so links stay as you wrote them.
                        </>
                      )}
                    </p>
                  </div>

                  {/* Advanced: the two switches most people never need. */}
                  <details className="mt-3 rounded-lg border border-gray-800 bg-gray-900/40">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm text-gray-300 hover:text-white">
                      Advanced options
                    </summary>
                    <div className="px-3 pb-3 space-y-3">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={lowSignal}
                          onChange={(e) => setLowSignal(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span>
                          <span className="text-sm text-gray-200 block">
                            Aim for Gmail&apos;s Primary inbox
                          </span>
                          <span className="text-[11px] text-gray-500 block mt-0.5">
                            Drops the tracking pixel, click redirects and bulk headers so Gmail is
                            less likely to file this under Promotions. Trade-off:{" "}
                            <b className="text-gray-400">no open/click stats</b> for this campaign.
                            The unsubscribe link stays.
                          </span>
                        </span>
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* ================= STEP 3 — REVIEW ================= */}
        {step === 3 && (
          <>
            <Card title="Ready to send" icon={<Send className="w-5 h-5 text-emerald-400" />}>
              <dl className="divide-y divide-gray-800 text-sm">
                <ReviewRow label="From" value={fromName ? `${fromName} <${fromEmail}>` : fromEmail || "—"} onEdit={() => setStep(2)} />
                <ReviewRow label="To" value={audienceLabel} onEdit={() => setStep(1)} />
                <ReviewRow label="Subject" value={subject || "—"} onEdit={() => setStep(2)} />
                <ReviewRow
                  label="Cost"
                  value={
                    adminMode
                      ? "Free (admin bypass)"
                      : isStaff
                      ? `Free (${user?.role})`
                      : `${costInCredits.toLocaleString()} credit${costInCredits === 1 ? "" : "s"} · 1 per ${EMAIL_BATCH_SIZE} recipients · balance ${availableCredits ?? "—"}`
                  }
                />
                {preflight && preflight.suppressed > 0 && (
                  <ReviewRow
                    label="Skipped"
                    value={`${preflight.suppressed.toLocaleString()} already bounced or unsubscribed — not sent, not charged`}
                  />
                )}
              </dl>

              {!canAfford && (
                <div className="mt-3 rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Not enough credits — you need {costInCredits.toLocaleString()} and have {availableCredits ?? 0}.
                </div>
              )}

              {/* Schedule is opt-in and folded away; most sends go now. */}
              <details className="mt-4 rounded-lg border border-gray-800 bg-gray-900/40" open={showSchedule}>
                <summary
                  className="cursor-pointer select-none px-3 py-2 text-sm text-gray-300 hover:text-white flex items-center gap-2"
                  onClick={() => setShowSchedule((v) => !v)}
                >
                  <Calendar className="w-4 h-4 text-gray-400" />
                  Send later instead
                </summary>
                <div className="px-3 pb-3">
                  <label htmlFor="schedule-at" className="block text-xs text-gray-400 mb-1">
                    Send at
                  </label>
                  <input
                    id="schedule-at"
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  />
                </div>
              </details>
            </Card>

            {/* Deliverability audit lives here, at the last responsible moment,
                instead of dominating the top of the page from the first click. */}
            {diag && (
              <div className={`rounded-xl border p-4 ${
                diag.percent >= 80
                  ? "border-emerald-700/60 bg-emerald-950/30"
                  : diag.percent >= 50
                  ? "border-amber-700/60 bg-amber-950/30"
                  : "border-rose-700/60 bg-rose-950/30"
              }`}>
                <button
                  type="button"
                  onClick={() => setDiagOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`text-2xl font-bold flex-shrink-0 ${
                      diag.percent >= 80 ? "text-emerald-300"
                      : diag.percent >= 50 ? "text-amber-300"
                      : "text-rose-300"
                    }`}>
                      {diag.percent}%
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">Deliverability check</div>
                      <div className="text-xs text-gray-300 truncate">
                        {diag.findings.filter((f) => f.level === "fail").length} fail ·{" "}
                        {diag.findings.filter((f) => f.level === "warn").length} warn ·{" "}
                        {diag.findings.filter((f) => f.level === "ok").length} ok
                        {" — "}
                        {diag.percent >= 80
                          ? "ready to send"
                          : diag.percent >= 50
                          ? "will probably land in spam — fix items below"
                          : "will land in spam — multiple critical issues"}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">{diagOpen ? "Hide ▲" : "Show ▼"}</span>
                </button>

                {diagOpen && (
                  <ul className="mt-3 space-y-2 border-t border-gray-800/50 pt-3">
                    {diag.findings.map((f, i) => (
                      <li
                        key={i}
                        className={`flex items-start gap-2 text-sm rounded-md p-2 ${
                          f.level === "fail" ? "bg-rose-950/40 text-rose-100"
                          : f.level === "warn" ? "bg-amber-950/30 text-amber-100"
                          : "bg-gray-900/40 text-gray-200"
                        }`}
                      >
                        <span className="flex-shrink-0 text-base leading-5">
                          {f.level === "fail" ? "❌" : f.level === "warn" ? "⚠️" : "✅"}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">{f.title}</div>
                          <div className="text-xs text-gray-300/90 mt-0.5">{f.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {/* Bottom bar — Back / Next while composing, the real actions at step 3. */}
        <div className="sticky bottom-0 -mx-6 px-6 py-3 z-30 bg-gray-950/95 backdrop-blur border-t border-gray-800 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="text-xs text-gray-400 min-h-[1rem]">
            {stepBlocker ? (
              <span className="text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {stepBlocker}
              </span>
            ) : step === 3 ? (
              <>
                Sending to <b className="text-white">{recipientsToSend.toLocaleString()}</b>
                {preflight && preflight.suppressed > 0 && (
                  <> · <span className="text-rose-300">{preflight.suppressed} skipped</span></>
                )}
              </>
            ) : (
              <span className="hidden sm:inline">Step {step} of 3</span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            {step === 1 ? (
              <Link
                href="/portal/campaigns"
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 text-center"
              >
                Cancel
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
              >
                ← Back
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canLeaveStep}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 border border-gray-700 text-gray-200 hover:border-gray-600 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  Save as draft
                </button>
                {showSchedule ? (
                  <button
                    type="button"
                    onClick={scheduleSend}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60"
                  >
                    <Calendar className="w-4 h-4" />
                    Schedule
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={requestSend}
                    disabled={busy || !canAfford}
                    className={`inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-medium ${
                      !canAfford || busy
                        ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    {canAfford ? `Send to ${recipientsToSend.toLocaleString()}` : "Not enough credits"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Send confirmation. Step 3 already showed the details, so this is a
            plain yes/no — except for big sends, where a slip is expensive and
            typing SEND is still worth the friction. */}
        {showSendConfirm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md">
              <div className="p-5 border-b border-gray-800">
                <h2 className="text-lg font-semibold text-white">
                  Send to {recipientsToSend.toLocaleString()}{" "}
                  {recipientsToSend === 1 ? "person" : "people"}?
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  This can&apos;t be undone — the email goes to SES straight away.
                </p>
              </div>

              <div className="p-5 space-y-2 text-sm">
                <Row label="From" value={fromEmail || "—"} />
                <Row label="Subject" value={subject || "—"} />
                <Row
                  label="Cost"
                  value={
                    adminMode ? "Free (admin bypass)"
                    : isStaff ? `Free (${user?.role})`
                    : `${costInCredits.toLocaleString()} credits`
                  }
                />

                {needsTypedConfirm && (
                  <div className="pt-2">
                    <label htmlFor="send-confirm" className="block text-xs text-gray-400 mb-1">
                      That&apos;s a big send. Type{" "}
                      <span className="font-mono text-amber-300">SEND</span> to confirm.
                    </label>
                    <input
                      id="send-confirm"
                      type="text"
                      value={sendConfirmText}
                      onChange={(e) => setSendConfirmText(e.target.value)}
                      placeholder="SEND"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                      autoFocus
                    />
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-gray-800 flex justify-end gap-2 bg-gray-900 rounded-b-2xl">
                <button
                  type="button"
                  onClick={() => { setShowSendConfirm(false); setSendConfirmText(""); }}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => submitCampaign("sending")}
                  disabled={busy || (needsTypedConfirm && sendConfirmText !== "SEND")}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send now"}
                </button>
              </div>
            </div>
          </div>
        )}

        <SenderManageDrawer
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          onChanged={(preferId?: string) => loadIdentities(preferId)}
        />
      </div>
    </AuthGuard>
  );
}

function Card({ id, title, icon, children }: { id?: string; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-gray-800 bg-gray-900 p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-gray-300">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-white break-all text-right ml-3">{value}</span>
    </div>
  );
}

/**
 * Wraps the user-typed HTML in a minimal document so single fragments (e.g.
 * just "<p>Hi</p>") render with sensible default styling.  Replaces our
 * unsubscribe placeholders with a # link so they don't look broken in preview.
 */
// Returns true when the sender's address is on a known free-mail provider —
// these all have strict DMARC policies that make bulk mail via SES go to spam.
const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "aol.com",
  "icloud.com", "me.com",
  "protonmail.com", "proton.me",
  "rediffmail.com",
  "zoho.com",
]);
/** True when a body already carries markup, so it belongs in the HTML editor. */
function looksLikeHtml(body: string): boolean {
  return /<!doctype/i.test(body) || /<([a-z][\w-]*)(\s[^>]*)?>/i.test(body);
}

function isFreeProviderSender(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return FREE_PROVIDER_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

function buildPreviewHtml(body: string): string {
  const preview = (body || "")
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, "#unsubscribe")
    .replace(/\{\{\s*unsubscribe_link\s*\}\}/gi, "#unsubscribe");
  // Plain-text body? Preview it exactly as it will be sent (formatted HTML),
  // so the user sees the real result before sending. ensureEmailHtml returns
  // HTML bodies unchanged.
  const isHtml = /<!doctype/i.test(preview) || /<([a-z][\w-]*)(\s[^>]*)?>/i.test(preview);
  if (preview.trim() && !isHtml) return ensureEmailHtml(preview);
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, Helvetica, sans-serif; color:#111; background:#fff;
         margin:0; padding:16px; line-height:1.5; }
  a { color:#0f766e; }
  img { max-width:100%; height:auto; }
  table { border-collapse:collapse; }
</style></head>
<body>${preview || "<p style=\"color:#9ca3af;font-style:italic\">(empty body)</p>"}</body></html>`;
}

/** One of the four audience options on step 1, as a click-anywhere card. */
function AudienceChoice({
  checked,
  onSelect,
  title,
  detail,
  blurb,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`text-left rounded-xl border p-3 transition-colors ${
        checked
          ? "border-emerald-600 bg-emerald-950/30"
          : "border-gray-800 bg-gray-900/40 hover:border-gray-600"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded-full border grid place-items-center shrink-0 ${
            checked ? "border-emerald-500" : "border-gray-600"
          }`}
        >
          {checked && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
        </span>
        <span className={`text-sm font-medium ${checked ? "text-white" : "text-gray-200"}`}>
          {title}
        </span>
        <span className="ml-auto text-xs text-gray-400 truncate">{detail}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-1 ml-6">{blurb}</p>
    </button>
  );
}

/**
 * The paged contact list on step 1.  Shared by "Narrow it down" (read-only —
 * the filter defines the audience, the list just shows what it caught) and
 * "Pick people" (checkboxes drive the selection).
 */
function RecipientPreviewList({
  visible,
  recLoading,
  filteredTotal,
  onLoadMore,
  pageSize,
  selectedIds,
  onToggle,
  readOnly,
}: {
  visible: RecipientRecord[];
  recLoading: boolean;
  filteredTotal: number;
  onLoadMore: () => void;
  pageSize: number;
  selectedIds?: Set<string>;
  onToggle?: (id: string, on: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <div>
      <div className="max-h-64 overflow-auto rounded-lg border border-gray-800">
        {visible.length === 0 && recLoading ? (
          <div className="p-3 text-sm text-gray-400">Loading contacts…</div>
        ) : visible.length === 0 ? (
          <div className="p-3 text-sm text-gray-400">No contacts match.</div>
        ) : (
          <>
            <ul className="divide-y divide-gray-800">
              {visible.map((r) => (
                <li
                  key={r.contact_id}
                  className={`px-3 py-2 text-sm grid gap-3 items-center ${
                    readOnly ? "grid-cols-[1fr_auto]" : "grid-cols-[auto_1fr_auto]"
                  }`}
                >
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={selectedIds?.has(r.contact_id) ?? false}
                      onChange={(e) => onToggle?.(r.contact_id, e.target.checked)}
                      aria-label={`Select ${r.contact_name || r.email}`}
                    />
                  )}
                  <div className="truncate text-gray-200">{r.contact_name || "(no name)"}</div>
                  <div className="text-gray-400 truncate text-right text-xs">{r.email}</div>
                </li>
              ))}
            </ul>
            {visible.length < filteredTotal && (
              <div className="p-2 border-t border-gray-800 sticky bottom-0 bg-gray-900">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={recLoading}
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 disabled:opacity-60"
                >
                  {recLoading
                    ? "Loading…"
                    : `Load ${Math.min(pageSize, filteredTotal - visible.length)} more (${filteredTotal - visible.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        Showing <b className="text-gray-300">{visible.length.toLocaleString()}</b> of{" "}
        <b className="text-gray-300">{filteredTotal.toLocaleString()}</b>
        {readOnly ? " — the whole matching set is sent, not just what's listed." : ""}
      </p>
    </div>
  );
}

/** A labelled line on the review step, with a shortcut back to fix it. */
function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <div className="py-2.5 flex items-start gap-3">
      <dt className="text-gray-500 w-20 shrink-0">{label}</dt>
      <dd className="text-gray-100 flex-1 min-w-0 break-words">{value}</dd>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-emerald-400 hover:underline shrink-0"
        >
          Change
        </button>
      )}
    </div>
  );
}
