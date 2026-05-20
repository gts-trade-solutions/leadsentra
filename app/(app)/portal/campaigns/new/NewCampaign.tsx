"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import WalletBadge from "@/components/WalletBadge";
import Instructions from "@/components/Instructions";
import { useOptionalAuth } from "@/components/AuthProvider";
import { useJobs } from "@/components/JobsProvider";
import {
  getMySender,
  startEmailVerify,
  checkEmailStatus,
  changesLeft,
  type EmailIdentityRow,
} from "@/lib/sender";
import { toast } from "@/hooks/use-toast";

type RecipientRecord = { contact_id: string; contact_name: string | null; email: string };
type SelectionMode = "all" | "filtered" | "selected";

const CHANGE_LIMIT = 2;

export default function NewCampaign() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useOptionalAuth();
  const isStaff = user?.role === "admin" || user?.role === "moderator";
  const { startSend } = useJobs();
  // Admin compose mode: ?admin=1 (only honored for staff).  Sends to EVERY
  // contact with an email (ignores unlocks) and skips credit charging.
  const adminMode = isStaff && searchParams?.get("admin") === "1";

  // Sender state
  const [mySender, setMySender] = useState<EmailIdentityRow | null>(null);
  const [fromEmail, setFromEmail] = useState("");
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [verStatus, setVerStatus] = useState<
    "idle" | "pending" | "verified" | "failed" | "error"
  >("idle");
  const latestStatus =
    verStatus !== "idle" ? verStatus : ((mySender?.status as any) ?? "idle");
  const isVerified = latestStatus === "verified";
  const left = changesLeft(mySender, CHANGE_LIMIT);
  const [editingSender, setEditingSender] = useState(false);

  // Campaign content
  const [campaignName, setCampaignName] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");

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

  // HTML editor / preview toggle.  Preview renders inside an iframe with
  // srcDoc so the campaign's HTML is fully isolated from the app's styles —
  // exactly what the recipient's mail client will render.
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
  const [filterSegment, setFilterSegment] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCompanyIds, setFilterCompanyIds] = useState<string[]>([]);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const companyMenuRef = useRef<HTMLDivElement | null>(null);
  const [segmentOptions, setSegmentOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [companyOptions, setCompanyOptions] = useState<{ company_id: string; name: string }[]>([]);

  // Close the multi-select Company dropdown when the user clicks outside it.
  useEffect(() => {
    if (!companyMenuOpen) return;
    function handleDocClick(e: MouseEvent) {
      const node = companyMenuRef.current;
      if (node && !node.contains(e.target as Node)) {
        setCompanyMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [companyMenuOpen]);

  // Load filter dropdown options once on mount.
  useEffect(() => {
    (async () => {
      try {
        const [segResp, compResp] = await Promise.all([
          fetch("/api/companies/segments", { credentials: "same-origin", cache: "no-store" }),
          fetch("/api/companies", { credentials: "same-origin", cache: "no-store" }),
        ]);
        const segJson = await segResp.json().catch(() => ({}));
        const compJson = await compResp.json().catch(() => ({}));
        setSegmentOptions(Array.isArray(segJson?.segments) ? segJson.segments : []);
        const companies = Array.isArray(compJson?.data) ? compJson.data : [];
        setCompanyOptions(
          companies
            .map((c: any) => ({ company_id: c.company_id, name: c.name || c.company_name || c.company_id }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
        );
        // Derive country list from the same companies payload (distinct, sorted).
        const countries = Array.from(
          new Set(
            companies
              .map((c: any) => String(c.country || "").trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));
        setCountryOptions(countries);
      } catch { /* leave dropdowns empty on failure */ }
    })();
  }, []);

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
      try {
        const row = await getMySender();
        setMySender(row);
        if (row?.email) setFromEmail(row.email);
        if (row?.status) setVerStatus(row.status as any);
      } catch { /* ignore */ }
      await refreshCredits();
      await loadCount();
      if (adminMode) await loadAllContactsCount();
    })();
  }, [adminMode]);

  useEffect(() => {
    setEditingSender(!isVerified);
  }, [isVerified]);

  // Auto-poll SES while the sender is pending — covers the case where the user
  // clicks the AWS verification link in another tab and returns to this page.
  // Silent: no toasts, no busy flag.  Stops as soon as we observe `verified`.
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
          if (!cancelled) {
            setEditingSender(false);
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
  }, [isVerified, fromEmail, identityId]);

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
      if (filterSegment)   u.searchParams.set("segment", filterSegment);
      if (filterCountry)   u.searchParams.set("country", filterCountry);
      // Multi-select: append company_id once per selected id.
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
        if (filterSegment)   url.searchParams.set("segment", filterSegment);
        if (filterCountry)   url.searchParams.set("country", filterCountry);
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
    [filterSegment, filterCountry, filterCompanyIds]
  );

  // Reload when search, mode, or any structured filter changes.
  useEffect(() => {
    if (mode === "all") {
      // Refresh the count to reflect the current filter set even in "all" mode.
      setVisible([]);
      setPageOffset(0);
      loadCount();
      return;
    }
    const t = setTimeout(() => {
      setPageOffset(0);
      loadPage(0, recSearch.trim().toLowerCase(), true);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recSearch, loadPage, filterSegment, filterCountry, filterCompanyIds]);

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
      // Don't bother for empty/selected-with-no-picks.
      if (mode === "selected" && selectedIds.size === 0 && !adminMode) {
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
  }, [mode, selectedIds, recSearch, adminMode, allContactsTotal, unlockedTotal, filteredTotal, filterSegment, filterCountry, filterCompanyIds]);

  const recipientsToSend = adminMode
    ? allContactsTotal
    : mode === "selected" ? selectedIds.size
    : mode === "filtered" ? filteredTotal
    : unlockedTotal;

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
    segment?: string;
    country?: string;
    company_id?: string;
  } {
    if (adminMode) {
      // Server checks staff role and downgrades to 'all' for non-staff.
      return { mode: "admin_all" };
    }
    // Structured filters apply to both 'all' and 'filtered' modes.
    // company_ids is an array so the audience picker can target multiple
    // companies in one campaign.
    const filters: Record<string, any> = {};
    if (filterSegment)              filters.segment     = filterSegment;
    if (filterCountry)              filters.country     = filterCountry;
    if (filterCompanyIds.length)    filters.company_ids = filterCompanyIds;

    if (mode === "selected") {
      return { mode: "selected", contact_ids: Array.from(selectedIds) };
    }
    if (mode === "filtered") {
      return { mode: "filtered", q: recSearch.trim().toLowerCase() || undefined, ...filters };
    }
    return { mode: "all", ...filters };
  }

  function loadMore() {
    const next = pageOffset + PAGE_SIZE;
    setPageOffset(next);
    loadPage(next, recSearch.trim().toLowerCase(), false);
  }

  async function handleStartVerify() {
    if (!fromEmail) return;
    const current = mySender?.email?.trim().toLowerCase();
    const target = fromEmail.trim().toLowerCase();
    const isNew = !current || current !== target;

    if (isNew && left === 0) {
      toast({
        variant: "destructive",
        title: "Change limit reached",
        description: `You can change your sender only ${CHANGE_LIMIT} times. Contact support to reset.`,
      });
      return;
    }
    if (mySender && isNew) {
      const ok = confirm(`Replace your current sender:\n${mySender.email}\n→ ${fromEmail}?`);
      if (!ok) return;
    }
    setBusy(true);
    try {
      const resp = await startEmailVerify(fromEmail);
      setIdentityId(resp?.id ?? null);
      setVerStatus("pending");
      const fresh = await getMySender();
      if (fresh) setMySender(fresh);
      toast({
        title: "Verification email sent",
        description: "Check your inbox to confirm.",
      });
    } catch (e: any) {
      setVerStatus("error");
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: e?.message || "Try again later.",
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
      if (resp.status === "verified") {
        const fresh = await getMySender();
        if (fresh) setMySender(fresh);
        setEditingSender(false);
        toast({ title: "Sender verified" });
      } else if (resp.status === "pending") {
        toast({ title: "Still pending", description: "Complete verification from your inbox." });
      } else if (resp.status === "failed") {
        toast({ variant: "destructive", title: "Verification failed" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not fetch status", description: e?.message || "" });
    } finally {
      setBusy(false);
    }
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
        status,
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

  return (
    <AuthGuard>
      {/* pb-24 leaves room under the sticky bottom bar so the last card
          (Send options) can scroll fully into view above it. */}
      <div className="space-y-6 pb-24">
        <SectionHeader
          title={adminMode ? "Admin compose" : "Create campaign"}
          description={
            adminMode
              ? "Sends to every contact regardless of unlock state. No credits charged."
              : "Compose, pick an audience, then save as draft, schedule, or send now."
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

        {/* Deliverability warning when the user is sending from a free provider
            (gmail.com / yahoo.com / outlook.com / etc).  Sending bulk mail FROM
            a personal address through SES fails DMARC at the receiver — that's
            why the mail lands in spam regardless of headers/content. */}
        {fromEmail && isFreeProviderSender(fromEmail) && (
          <div className="rounded-xl border border-rose-700/70 bg-rose-950/40 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-rose-100 min-w-0 flex-1">
              <div className="font-semibold">
                Your mail will land in SPAM
              </div>
              <div className="text-rose-200/90 mt-1">
                You're sending from <b className="break-all">{fromEmail}</b>, which is a free email provider
                ({fromEmail.split("@")[1]}).  Gmail, Outlook and Yahoo all REJECT or spam-folder mail that
                claims to be from a free-provider address but didn't come from their own servers (DMARC).
                No header or content tweak can fix this.
              </div>
              <div className="text-rose-200/90 mt-2">
                <b>Fix:</b> change your sender to an address on a domain you own (e.g.
                <code className="mx-1 px-1 bg-rose-950/80 rounded">marketing@raceautoindia.com</code>).
                The <code>raceautoindia.com</code> domain is already DKIM-verified in your SES — switching
                to it eliminates this issue entirely.
              </div>
              <div className="mt-2">
                <Link
                  href="/portal/campaigns/new#sender"
                  onClick={(e) => {
                    e.preventDefault();
                    document.querySelector("#sender")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-rose-700 hover:bg-rose-600 text-white text-xs font-medium"
                >
                  Change sender now
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Deliverability score — full audit of why mail might be spam-foldered.
            Always visible (collapsible) so the user can see exactly which
            requirement is failing. */}
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
                  <div className="text-sm font-semibold text-white">
                    Deliverability score
                  </div>
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

        <Instructions title="How sending works" variant="success" defaultOpen={false}>
          <ul className="text-sm list-disc list-inside space-y-1">
            <li><b>Pick a sender</b> and verify it via SES — the From address recipients will see.</li>
            <li><b>Audience</b>: by default all your unlocked contacts. Filter or pick specific ones below.</li>
            <li><b>Credits</b>: 1 credit per recipient. Suppressed addresses are skipped and not charged.</li>
            <li><b>Schedule for later</b> instead of sending now — leaves the campaign as <code>scheduled</code> until the time arrives.</li>
            <li><b>Suppressed</b> emails (bounces, complaints, unsubscribes, manual blocks) are filtered out automatically.</li>
          </ul>
        </Instructions>

        {/* Sender card */}
        <Card id="sender" title="Sender" icon={<Mail className="w-5 h-5 text-emerald-400" />}>
          {mySender && (
            <div className="mb-3 p-3 border border-gray-700 rounded-lg bg-gray-900/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="text-xs text-gray-400 mb-1">Your sender</div>
                <div className="text-sm text-white break-all">{mySender.email}</div>
                {mySender.status !== "verified" && (
                  <div className="text-xs text-amber-300 mt-0.5">{mySender.status}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Verified status badge — green when SES confirms the
                    identity is ready to send from, red otherwise. The
                    previous render hid the badge entirely until verified,
                    so users assumed "no badge = OK" and tried to send. */}
                {isVerified ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-emerald-900/30 text-emerald-200 border border-emerald-700">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verified
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-rose-900/30 text-rose-200 border border-rose-700"
                    title="This sender hasn't completed SES verification yet — campaigns won't send until it does."
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Not verified
                  </span>
                )}
                {/* Change-sender toggle — visible whether verified or not so the
                    user can swap to a domain sender (e.g. marketing@raceautoindia.com)
                    even after they've previously verified a gmail address. */}
                {!editingSender && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSender(true);
                      // Pre-clear so they see an empty box rather than the
                      // existing address (they're about to type a different one).
                      setFromEmail("");
                    }}
                    disabled={left === 0}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 disabled:opacity-50"
                    title={
                      left === 0
                        ? `Sender change limit reached (${CHANGE_LIMIT}/${CHANGE_LIMIT}). Contact support to reset.`
                        : `Change your sender (${left} change${left === 1 ? "" : "s"} left)`
                    }
                  >
                    <RefreshCcw className="w-3 h-3" />
                    Change
                  </button>
                )}
              </div>
            </div>
          )}

          {editingSender && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end">
              <div>
                <label htmlFor="from-email" className="block text-sm text-gray-300 mb-1">
                  {isVerified ? "New sender email" : "From (sender email)"}
                </label>
                <input
                  id="from-email"
                  type="email"
                  placeholder="you@company.com"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                />
                {mySender && (
                  <p className="text-xs text-gray-400 mt-1">
                    You can change your sender <b>{left}</b> more {left === 1 ? "time" : "times"}
                    {" "}(max {CHANGE_LIMIT}).
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleStartVerify}
                disabled={!fromEmail || busy}
                className="h-[42px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {busy ? "Working…" : isVerified ? "Send to new email" : "Verify"}
              </button>
              <button
                type="button"
                onClick={pollVerification}
                disabled={busy || latestStatus === "idle"}
                className="h-[42px] px-4 rounded-lg border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200 text-sm flex items-center gap-1"
              >
                <RefreshCcw className="w-4 h-4" />
                Check status
              </button>
            </div>
          )}

          {/* Cancel button to back out of edit mode without changing anything,
              only shown when the user explicitly clicked Change on a verified
              sender (and we have something to revert to). */}
          {editingSender && isVerified && mySender?.email && (
            <div className="mt-2 text-right">
              <button
                type="button"
                onClick={() => {
                  setEditingSender(false);
                  setFromEmail(mySender.email);
                }}
                className="text-xs text-gray-400 hover:text-gray-200 underline"
              >
                Cancel — keep {mySender.email}
              </button>
            </div>
          )}
        </Card>

        {/* Content card */}
        <Card title="Content" icon={<Eye className="w-5 h-5 text-emerald-400" />}>
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
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              />
            </div>
            <div>
              <label htmlFor="camp-subject" className="block text-sm font-medium text-gray-300 mb-1">
                Subject line
              </label>
              <input
                id="camp-subject"
                type="text"
                placeholder="Enter the email subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              />
            </div>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="camp-content" className="block text-sm font-medium text-gray-300">
                  Email content
                </label>
                {/* Code / Preview toggle */}
                <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setEditorView("code")}
                    className={`px-3 py-1.5 transition-colors ${
                      editorView === "code"
                        ? "bg-emerald-600 text-white"
                        : "text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorView("preview")}
                    disabled={!content.trim()}
                    className={`px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      editorView === "preview"
                        ? "bg-emerald-600 text-white"
                        : "text-gray-300 hover:bg-gray-700"
                    }`}
                    title={content.trim() ? "See what recipients will see" : "Write something first"}
                  >
                    Preview
                  </button>
                </div>
              </div>

              {editorView === "code" ? (
                <textarea
                  id="camp-content"
                  rows={12}
                  placeholder={
                    "<p>Hi {{name}},</p>\n<p>Your message here…</p>\n<p><a href=\"{{unsubscribe_link}}\">Unsubscribe</a></p>"
                  }
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 font-mono text-sm resize-y"
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
                Use <code className="text-gray-400">{"{{unsubscribe_link}}"}</code> anywhere — it's replaced per recipient.
                Preview is sandboxed (no JS, no external requests).
              </p>
            </div>
          </div>
        </Card>

        {/* Audience card */}
        <Card title="Audience" icon={<Mail className="w-5 h-5 text-emerald-400" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <div className="block text-sm text-gray-300 mb-1">Send to</div>
              {adminMode ? (
                <div className="text-sm text-amber-100">
                  Every contact with a valid email (admin bypass).
                </div>
              ) : (
                <div className="flex items-center gap-4 text-sm text-gray-200">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} />
                    {isStaff ? "All contacts" : "All unlocked"}
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={mode === "filtered"} onChange={() => setMode("filtered")} />
                    Filtered
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={mode === "selected"} onChange={() => setMode("selected")} />
                    Selected ({selectedIds.size})
                  </label>
                </div>
              )}
            </div>
            <div className="text-sm text-right">
              {adminMode ? (
                <>
                  <div className="text-gray-300">
                    Recipients: <b className="text-white">{recipientsToSend.toLocaleString()}</b>
                  </div>
                  <div className="text-[11px] text-emerald-300">
                    No credits charged (admin bypass)
                  </div>
                </>
              ) : isStaff ? (
                <>
                  <div className="text-gray-300">
                    Recipients: <b className="text-white">{recipientsToSend.toLocaleString()}</b>
                  </div>
                  <div className="text-[11px] text-emerald-300">
                    No credits charged ({user?.role})
                  </div>
                </>
              ) : (
                <>
                  <div className="text-gray-400">Credits available: <b className="text-white">{availableCredits ?? "—"}</b></div>
                  <div className="text-gray-300">
                    Recipients: <b className="text-white">{recipientsToSend.toLocaleString()}</b>
                    {" · "}Cost: <b className="text-white">{costInCredits.toLocaleString()}</b> credit{costInCredits === 1 ? "" : "s"}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    1 credit per {EMAIL_BATCH_SIZE} recipients
                  </div>
                  {!canAfford && (
                    <div className="text-amber-300 text-xs mt-1 flex items-center gap-1 justify-end">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Not enough credits
                    </div>
                  )}
                </>
              )}

              {/* Suppression breakdown: shown for everyone (admin/staff/user)
                  so it's obvious that bounced/complained/unsubscribed
                  addresses are being skipped automatically. */}
              {preflight && preflight.suppressed > 0 && (
                <div
                  className="text-[11px] mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                             bg-rose-900/30 text-rose-200 border border-rose-700"
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
                  {preflight.suppressed.toLocaleString()} suppressed — will be skipped
                </div>
              )}
              {preflight && preflight.suppressed === 0 && preflightLoading === false && preflight.total > 0 && (
                <div className="text-[11px] text-emerald-300/80 mt-1">
                  No suppressed addresses in this audience
                </div>
              )}
            </div>
          </div>

          {/* Structured audience filters (segment / country / company).
              Available in every mode except `admin_all` (which sends to all). */}
          {!adminMode && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Segment</label>
                <select
                  value={filterSegment}
                  onChange={(e) => setFilterSegment(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="">All segments</option>
                  {segmentOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Country</label>
                <select
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="">All countries</option>
                  {countryOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="relative" ref={companyMenuRef}>
                <label className="block text-xs text-gray-400 mb-1">Company</label>
                <button
                  type="button"
                  onClick={() => setCompanyMenuOpen((o) => !o)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm text-left flex items-center justify-between gap-2"
                  aria-haspopup="listbox"
                  aria-expanded={companyMenuOpen}
                >
                  <span className="truncate">
                    {filterCompanyIds.length === 0
                      ? "All companies"
                      : filterCompanyIds.length === 1
                      ? companyOptions.find((c) => c.company_id === filterCompanyIds[0])?.name ?? "1 company"
                      : `${filterCompanyIds.length} companies selected`}
                  </span>
                  <span className="text-gray-500">▾</span>
                </button>
                {companyMenuOpen && (
                  <div className="absolute z-30 mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 shadow-xl">
                    <div className="sticky top-0 p-2 border-b border-gray-700 bg-gray-800 flex items-center gap-2">
                      <input
                        type="text"
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                        placeholder="Search…"
                        className="flex-1 px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      {filterCompanyIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCompanyIds([])}
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto py-1">
                      {companyOptions
                        .filter((c) =>
                          companySearch.trim()
                            ? c.name.toLowerCase().includes(companySearch.trim().toLowerCase())
                            : true,
                        )
                        .map((c) => {
                          const checked = filterCompanyIds.includes(c.company_id);
                          return (
                            <li key={c.company_id}>
                              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-sm text-gray-200">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setFilterCompanyIds((prev) =>
                                      e.target.checked
                                        ? [...prev, c.company_id]
                                        : prev.filter((id) => id !== c.company_id),
                                    )
                                  }
                                  className="rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                                />
                                <span className="truncate">{c.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      {companyOptions.length === 0 && (
                        <li className="px-3 py-2 text-xs text-gray-500">No companies available</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => { setFilterSegment(""); setFilterCountry(""); setFilterCompanyIds([]); }}
                  disabled={!filterSegment && !filterCountry && filterCompanyIds.length === 0}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600 disabled:opacity-50"
                >
                  Clear filters
                </button>
              </div>
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
          ) : mode === "all" ? (
            // "All unlocked" — no list needed.  We never load 4000 rows for this.
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-300">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-400" />
                <span>
                  Will send to <b className="text-white">{unlockedTotal.toLocaleString()}</b>{" "}
                  {isStaff ? "contact" : "unlocked contact"}{unlockedTotal === 1 ? "" : "s"}.
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Suppressed addresses are filtered out automatically. Switch to <b>Filtered</b>
                {" "}or <b>Selected</b> if you want to narrow it down.
              </p>
            </div>
          ) : (
            <>
              {/* Search + bulk select row */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <div>
                  <label htmlFor="rec-search" className="block text-xs text-gray-400 mb-1">
                    Search contacts
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      id="rec-search"
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
                  onClick={() => {
                    setSelectedIds(new Set(visible.map((v) => v.contact_id)));
                    setMode("selected");
                  }}
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

              {/* Selected chips strip — visible whenever something is selected */}
              {mode === "selected" && selectedIds.size > 0 && (
                <div className="mt-3 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-3">
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
                        <span className="truncate max-w-[180px]">
                          {r.contact_name || r.email}
                        </span>
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

              {/* Results list — paginated, server-side, no client-side sort */}
              <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-gray-800">
                {visible.length === 0 && recLoading ? (
                  <div className="p-3 text-sm text-gray-400">Loading contacts…</div>
                ) : visible.length === 0 ? (
                  <div className="p-3 text-sm text-gray-400">No unlocked contacts match.</div>
                ) : (
                  <>
                    <ul className="divide-y divide-gray-800">
                      {visible.map((r) => (
                        <li
                          key={r.contact_id}
                          className="px-3 py-2 text-sm grid grid-cols-[auto_1fr_auto] gap-3 items-center"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.contact_id)}
                            onChange={(e) => {
                              setMode("selected");
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(r.contact_id);
                                else next.delete(r.contact_id);
                                return next;
                              });
                            }}
                            aria-label={`Select ${r.contact_name || r.email}`}
                          />
                          <div className="truncate text-gray-200">{r.contact_name || "(no name)"}</div>
                          <div className="text-gray-400 truncate text-right text-xs">{r.email}</div>
                        </li>
                      ))}
                    </ul>
                    {visible.length < filteredTotal && (
                      <div className="p-2 border-t border-gray-800 sticky bottom-0 bg-gray-900">
                        <button
                          type="button"
                          onClick={loadMore}
                          disabled={recLoading}
                          className="w-full px-3 py-1.5 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 disabled:opacity-60"
                        >
                          {recLoading
                            ? "Loading…"
                            : `Load ${Math.min(PAGE_SIZE, filteredTotal - visible.length)} more (${filteredTotal - visible.length} remaining)`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="mt-2 text-[11px] text-gray-500 flex items-center justify-between gap-2">
                <span>
                  Showing <b className="text-gray-300">{visible.length.toLocaleString()}</b> of{" "}
                  <b className="text-gray-300">{filteredTotal.toLocaleString()}</b>
                  {recSearch.trim() ? " filtered" : ""} · Unlocked total{" "}
                  <b className="text-gray-300">{unlockedTotal.toLocaleString()}</b>
                </span>
                {mode === "filtered" && recSearch.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      // Switch the user explicitly to a "selected" virtual set
                      // for the current filter.  We won't materialize 4000 ids
                      // here — instead we just send the campaign with mode='filtered'
                      // and the server resolves the audience server-side.
                      // The recipient count is already accurate (filteredTotal).
                    }}
                    className="text-emerald-400 hover:underline"
                    title="The full filtered set will be sent — the table only previews it"
                  >
                    Send to all {filteredTotal.toLocaleString()} matching
                  </button>
                )}
              </div>
            </>
          )}
        </Card>

        {/* Send options */}
        <Card title="Send options" icon={<Send className="w-5 h-5 text-emerald-400" />}>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={showSchedule}
              onChange={(e) => setShowSchedule(e.target.checked)}
            />
            Schedule for later
          </label>
          {showSchedule && (
            <div className="mt-3">
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
          )}
        </Card>

        {/* Bottom action bar — sticky to the main scroll container.
            `pb-24` on the page wrapper leaves room for the last card to scroll
            fully into view above the bar, so it no longer covers the editor. */}
        <div className="sticky bottom-0 -mx-6 px-6 py-3 z-30 bg-gray-950/95 backdrop-blur border-t border-gray-800 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          {/* Left: lightweight context */}
          <div className="text-xs text-gray-400 hidden sm:block">
            {recipientsToSend > 0 ? (
              <>
                Will send to <b className="text-white">{recipientsToSend.toLocaleString()}</b>
                {preflight && preflight.suppressed > 0 && (
                  <> · <span className="text-rose-300">{preflight.suppressed} suppressed</span></>
                )}
              </>
            ) : (
              <>Pick an audience to enable Send</>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Link
              href="/portal/campaigns"
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 text-center"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={saveDraft}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Save as draft
            </button>
            {showSchedule ? (
              <button
                type="button"
                onClick={scheduleSend}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60"
              >
                <Calendar className="w-4 h-4" />
                Schedule
              </button>
            ) : (
              <button
                type="button"
                onClick={requestSend}
                disabled={busy || !canAfford}
                className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                  !canAfford || busy
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
                title="Send is destructive — you'll be asked to confirm"
              >
                <Send className="w-4 h-4" />
                {canAfford ? "Send now" : "Insufficient credits"}
              </button>
            )}
          </div>
        </div>

        {/* Send confirmation */}
        {showSendConfirm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-2xl border border-red-800/60 w-full max-w-md max-h-[85vh] flex flex-col">
              {/* Header — fixed at top */}
              <div className="p-5 border-b border-gray-800 flex-shrink-0">
                <h2 className="text-lg font-semibold text-red-300">
                  Send to {recipientsToSend} contact{recipientsToSend === 1 ? "" : "s"}?
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  This is irreversible. The email is queued to SES immediately.
                </p>
              </div>

              {/* Body — scrolls if too tall */}
              <div className="p-5 space-y-3 text-sm overflow-y-auto custom-scrollbar flex-1 min-h-0">
                <Row label="From"        value={fromEmail || "—"} />
                <Row
                  label="Audience"
                  value={
                    preflight && preflight.suppressed > 0
                      ? `${preflight.willSend} send · ${preflight.suppressed} skipped`
                      : `${recipientsToSend}`
                  }
                />
                <Row
                  label="Cost"
                  value={
                    adminMode
                      ? "Free (admin bypass)"
                      : isStaff
                      ? `Free (${user?.role})`
                      : `${costInCredits.toLocaleString()} cr (1 per ${EMAIL_BATCH_SIZE})`
                  }
                />
                <Row label="Subject" value={subject || "—"} />

                <div className="pt-2">
                  <label htmlFor="send-confirm" className="block text-xs text-gray-400 mb-1">
                    To confirm, type <span className="font-mono text-red-300">SEND</span> below
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
              </div>

              {/* Footer — fixed at bottom */}
              <div className="p-4 border-t border-gray-800 flex justify-end gap-2 bg-gray-900 rounded-b-2xl flex-shrink-0">
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
                  disabled={busy || sendConfirmText !== "SEND"}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                >
                  {busy ? "Sending…" : `Send to ${recipientsToSend}`}
                </button>
              </div>
            </div>
          </div>
        )}
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
function isFreeProviderSender(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return FREE_PROVIDER_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

function buildPreviewHtml(body: string): string {
  const preview = (body || "")
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, "#unsubscribe")
    .replace(/\{\{\s*unsubscribe_link\s*\}\}/gi, "#unsubscribe");
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
