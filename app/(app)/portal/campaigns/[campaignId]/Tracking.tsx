"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCcw,
  Search,
  Eye,
  MousePointerClick,
  CheckCircle2,
  AlertTriangle,
  Mail,
  ShieldOff,
  FileText,
  Copy,
  Check,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import StatCard from "@/components/StatCard";
import { toast } from "@/hooks/use-toast";
import { ACCEPTED_STATUSES, statsFromRows } from "@/lib/campaignStats";

type RecipientRow = {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  contact_name: string | null;
  email: string;
  status: string;
  message_id: string | null;
  error_reason: string | null;
  bounced_at: string | null;
  complaint_at: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  last_event_at: string | null;
  opens_count: number;
  clicks_count: number;
};

type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  subject?: string | null;
};

/** The message as it went out — GET /api/campaigns/[id]/content. */
type SentContent = {
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  recipients_count: number;
  low_signal: boolean;
  created_at: string;
  html: string;
  rendered_html: string;
  text: string;
};

type Filter =
  | "all" | "delivered" | "opened" | "clicked"
  | "bounced" | "complained" | "not_opened" | "suppressed" | "failed";

const PER_PAGE = 100;

/** Statuses that count as "went out and has not failed since". */
const ACCEPTED: readonly string[] = ACCEPTED_STATUSES;

export default function TrackingPage({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);

  // "What you sent" panel. Fetched once, separately from the recipients poll —
  // the body can be a large template and there's no reason to re-ship it every
  // 15 seconds while a send drains.
  const [content, setContent] = useState<SentContent | null>(null);
  const [contentOpen, setContentOpen] = useState(false);
  const [contentView, setContentView] = useState<"preview" | "text" | "html">("preview");
  const [copied, setCopied] = useState<"text" | "html" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/content`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setContent(json as SentContent);
      } catch {
        /* the panel is additive — tracking still works without it */
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  async function copy(kind: "text" | "html") {
    const value = kind === "text" ? content?.text : content?.html;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast({ variant: "destructive", title: "Couldn't copy", description: "Select the text and copy manually." });
    }
  }

  async function load() {
    setLoading(true);
    try {
      // Recipients
      const recRes = await fetch(`/api/campaigns/${campaignId}/recipients`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const recJson = await recRes.json().catch(() => ({}));
      if (!recRes.ok) {
        toast({ variant: "destructive", title: "Failed to load tracking", description: recJson?.error || "" });
      }
      setRows(Array.isArray(recJson?.recipients) ? recJson.recipients : []);
      // The summary comes back with the recipients. It used to be found by
      // pulling the entire campaign list and filtering client-side, which
      // fetched everything on every 15s refresh and never found a campaign
      // owned by another user (i.e. any campaign an admin opened).
      if (recJson?.campaign) setCampaign(recJson.campaign as CampaignSummary);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Network error", description: e?.message || "" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [campaignId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, campaignId]);

  // Same aggregator the campaign list, the progress widget and the global
  // email-status page use.  This page used to count "Delivered" as rows whose
  // status is literally 'delivered' — a state only ever reached when SES posts
  // a Delivery event.  With no SES configuration set wired up nothing ever
  // reaches it, so this card read 0 on campaigns the list showed as fully
  // delivered, and the "Delivered" filter returned an empty table.
  const stats = useMemo(() => statsFromRows(rows), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const m =
        filter === "all" ||
        // "Delivered" means accepted by the provider and not since failed —
        // matching status === 'delivered' alone hid every recipient who has
        // since opened or clicked, plus everyone still awaiting a Delivery
        // event that only arrives when SES webhooks are configured.
        (filter === "delivered" && ACCEPTED.includes(r.status)) ||
        (filter === "opened" && (!!r.opened_at || (r.opens_count || 0) > 0)) ||
        (filter === "clicked" && (!!r.clicked_at || (r.clicks_count || 0) > 0)) ||
        (filter === "bounced" && r.status === "bounced") ||
        (filter === "complained" && r.status === "complained") ||
        (filter === "suppressed" && r.status === "suppressed") ||
        (filter === "failed" && r.status === "failed") ||
        (filter === "not_opened" &&
          !r.opened_at &&
          (r.opens_count || 0) === 0 &&
          ACCEPTED.includes(r.status));
      if (!m) return false;
      if (!q) return true;
      const name = (r.contact_name || "").toLowerCase();
      const email = (r.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rows, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  useEffect(() => setPage(1), [filter, search]);
  const pageSlice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <AuthGuard>
      <div className="space-y-6">
        <SectionHeader
          title={campaign?.name || "Campaign"}
          description={
            campaign
              ? <span className="inline-flex items-center gap-2">
                  <span className="text-gray-300">Status:</span>
                  <StatusBadge status={campaign.status} />
                  <span className="text-gray-500">·</span>
                  <span className="text-gray-400 text-xs">Created {new Date(campaign.created_at).toLocaleString()}</span>
                </span>
              : "Recipient activity"
          }
        >
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
            title="Automatically refresh the table every 15 seconds"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors ${
              autoRefresh
                ? "bg-emerald-600/15 border-emerald-600 text-emerald-300"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
            }`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-gray-500"}`}
            />
            Auto-refresh (15s)
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link
            href="/portal/campaigns"
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        </SectionHeader>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard title="Recipients"      value={String(stats.recipients)}      icon={Mail} />
          <StatCard title="Delivered"       value={String(stats.accepted)}        icon={CheckCircle2} />
          <StatCard title="Opened (unique)" value={String(stats.opened_unique)}   icon={Eye} />
          <StatCard title="Opens"           value={String(stats.opens_total)}     icon={Eye} />
          <StatCard title="Clicks"          value={String(stats.clicks_total)}    icon={MousePointerClick} />
          <StatCard
            title="Bounced / Compl."
            value={String(stats.bounced + stats.complained)}
            icon={AlertTriangle}
          />
        </div>

        {/* The provider took the mail but has never told us what happened to
            it.  Without this banner the page just shows zero bounces and zero
            confirmed deliveries, which reads as "everything is fine" when in
            fact the feedback loop is disconnected and bounced addresses are
            never suppressed — so the same dead address is mailed again on the
            next campaign. */}
        {stats.delivery_feedback_missing && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-700/60 bg-amber-950/30 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-100/90">
              <div className="font-medium text-amber-200">
                No delivery or bounce feedback received for this campaign
              </div>
              <p className="text-xs text-amber-100/70 mt-1">
                {stats.accepted.toLocaleString()} message
                {stats.accepted === 1 ? " was" : "s were"} accepted by the provider, but
                it has never reported a delivery, bounce, or complaint back to LeadSentra.
                Until that feedback arrives, bounced addresses are not added to your
                suppression list and will be mailed again by the next campaign.{" "}
                <Link href="/portal/campaigns/suppressions" className="underline hover:text-amber-100">
                  Import bounces from SES
                </Link>{" "}
                to catch up, and connect the SES event webhook to keep it current.
              </p>
            </div>
          </div>
        )}

        {/* What you sent — the message itself, next to who received it. The
            table shows opens and clicks; this is the thing you actually need
            in front of you when writing the follow-up. */}
        {content && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
            <button
              type="button"
              onClick={() => setContentOpen((v) => !v)}
              aria-expanded={contentOpen}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
            >
              <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">What you sent</div>
                <div className="text-xs text-gray-400 truncate">
                  {content.subject || <em className="text-gray-500">(no subject)</em>}
                  {content.from_email && (
                    <span className="text-gray-500"> · from {content.from_email}</span>
                  )}
                </div>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {contentOpen ? "Hide ▲" : "View message ▼"}
              </span>
            </button>

            {contentOpen && (
              <div className="border-t border-gray-800 p-4 space-y-3">
                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <Detail label="From" value={
                    content.from_name
                      ? `${content.from_name} <${content.from_email ?? "—"}>`
                      : content.from_email || "—"
                  } />
                  <Detail label="Subject" value={content.subject || "—"} />
                  <Detail label="Sent" value={new Date(content.created_at).toLocaleString()} />
                  <Detail
                    label="Recipients"
                    value={`${content.recipients_count.toLocaleString()}${
                      content.low_signal ? " · Primary-inbox mode (no open/click tracking)" : ""
                    }`}
                  />
                </dl>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 overflow-hidden text-xs">
                    {(["preview", "text", "html"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setContentView(v)}
                        className={`px-3 py-1.5 transition-colors ${
                          contentView === v
                            ? "bg-emerald-600 text-white"
                            : "text-gray-300 hover:bg-gray-700"
                        }`}
                      >
                        {v === "preview" ? "Preview" : v === "text" ? "Plain text" : "HTML"}
                      </button>
                    ))}
                  </div>
                  {contentView !== "preview" && (
                    <button
                      type="button"
                      onClick={() => copy(contentView === "text" ? "text" : "html")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 border border-gray-700 text-gray-200 hover:border-gray-600"
                    >
                      {copied === (contentView === "text" ? "text" : "html") ? (
                        <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied</>
                      ) : (
                        <><Copy className="w-3.5 h-3.5" /> Copy {contentView === "text" ? "text" : "HTML"}</>
                      )}
                    </button>
                  )}
                  {contentView === "text" && (
                    <span className="text-[11px] text-gray-500">
                      Paste this straight into a manual follow-up.
                    </span>
                  )}
                </div>

                {!content.rendered_html ? (
                  <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-400">
                    This campaign has no saved body — it was created before the
                    message was written, or saved as an empty draft.
                  </div>
                ) : contentView === "preview" ? (
                  // Sandboxed so the stored HTML can't run scripts or reach the
                  // network from inside the portal.
                  <div className="rounded-lg border border-gray-700 bg-white overflow-hidden">
                    <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-xs text-gray-600 flex items-center justify-between gap-2">
                      <span className="truncate">
                        <b>Subject:</b> {content.subject || "(none)"}
                      </span>
                      <span className="text-gray-500 shrink-0">
                        From: {content.from_email || "—"}
                      </span>
                    </div>
                    <iframe
                      title="Sent message"
                      sandbox=""
                      srcDoc={content.rendered_html}
                      className="w-full bg-white"
                      style={{ height: 460, border: 0 }}
                    />
                  </div>
                ) : (
                  <pre className="rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 overflow-auto whitespace-pre-wrap break-words max-h-[460px]">
                    {contentView === "text" ? content.text : content.html}
                  </pre>
                )}

                <p className="text-[11px] text-gray-500">
                  Tracking pixels and click-redirects are added per recipient at
                  send time, so the preview shows the message body without them.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Secondary stats row */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs text-gray-400 flex flex-wrap gap-x-6 gap-y-1">
          <span><b className="text-gray-200">{stats.attempted}</b> sent</span>
          <span
            title="Confirmed by the provider's delivery notification. Stays at 0 until the SES event webhook is connected."
          >
            <b className="text-gray-200">{stats.confirmed}</b> delivery-confirmed
          </span>
          <span><b className="text-gray-200">{stats.queued}</b> queued</span>
          <span>
            <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-1 text-rose-300" />
            <b className="text-rose-300">{stats.failed}</b> failed (not sent)
          </span>
          <span>
            <ShieldOff className="w-3 h-3 inline -mt-0.5 mr-1 text-orange-300" />
            <b className="text-orange-300">{stats.suppressed}</b> suppressed (skipped, no charge)
          </span>
        </div>

        {/* Filters + search */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["delivered", "Delivered"],
                ["opened", "Opened"],
                ["clicked", "Clicked"],
                ["not_opened", "Not opened"],
                ["bounced", "Bounced"],
                ["complained", "Complained"],
                ["failed", "Failed"],
                ["suppressed", "Suppressed"],
              ] as [Filter, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className={`px-3 py-1.5 rounded-lg border text-xs ${
                  filter === val
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                    : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search recipients"
              className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Recipients table */}
        <div className="overflow-auto rounded-xl border border-gray-800 bg-gray-900">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-gray-900/80 text-gray-400 uppercase tracking-wider text-xs">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Sent</th>
                <th className="text-left px-3 py-2">Opened</th>
                <th className="text-left px-3 py-2">Clicks</th>
                <th className="text-left px-3 py-2">Last event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-4 text-gray-400">Loading…</td></tr>
              ) : pageSlice.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-4 text-gray-400">No matching recipients.</td></tr>
              ) : (
                pageSlice.map((r) => (
                  <tr key={r.id} className="text-gray-200">
                    <td className="px-3 py-2 max-w-[220px] truncate">{r.contact_name || "—"}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate text-gray-300">{r.email}</td>
                    <td className="px-3 py-2">
                      <RecipientStatus status={r.status} />
                      {r.error_reason &&
                        (r.status === "failed" || r.status === "bounced" || r.status === "complained") && (
                          <div
                            className="mt-1 max-w-[280px] text-xs text-rose-300/90 break-words"
                            title={r.error_reason}
                          >
                            {r.error_reason}
                          </div>
                        )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(r.sent_at)}</td>
                    <td className="px-3 py-2">
                      {r.opens_count > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <Eye className="w-3.5 h-3.5" /> {r.opens_count}
                          </span>
                          <span className="text-xs text-gray-500">{fmtDate(r.opened_at)}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.clicks_count > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-indigo-300">
                            <MousePointerClick className="w-3.5 h-3.5" /> {r.clicks_count}
                          </span>
                          <span className="text-xs text-gray-500">{fmtDate(r.clicked_at)}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(r.last_event_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            Showing <b className="text-gray-200">{filtered.length === 0 ? 0 : (page - 1) * PER_PAGE + 1}</b>
            {"–"}<b className="text-gray-200">{Math.min(page * PER_PAGE, filtered.length)}</b>{" "}
            of <b className="text-gray-200">{filtered.length.toLocaleString()}</b> recipients
            {filter !== "all" || search ? " (filtered)" : ""}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="px-3 text-sm text-gray-200">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}

function RecipientStatus({ status }: { status: string }) {
  const cls =
    status === "delivered"
      ? "bg-emerald-600/20 text-emerald-300 border-emerald-700"
      : status === "bounced" || status === "complained"
      ? "bg-red-600/20 text-red-300 border-red-700"
      : status === "clicked"
      ? "bg-indigo-600/20 text-indigo-300 border-indigo-700"
      : status === "opened"
      ? "bg-sky-600/20 text-sky-300 border-sky-700"
      : status === "suppressed"
      ? "bg-orange-600/20 text-orange-300 border-orange-700"
      : status === "sent"
      ? "bg-gray-600/20 text-gray-300 border-gray-600"
      : "bg-gray-700/40 text-gray-300 border-gray-700";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "bg-emerald-600/20 text-emerald-300 border-emerald-700"
      : status === "sending"
      ? "bg-sky-600/20 text-sky-300 border-sky-700"
      : status === "scheduled"
      ? "bg-amber-600/20 text-amber-300 border-amber-700"
      : status === "failed"
      ? "bg-red-600/20 text-red-300 border-red-700"
      : "bg-gray-600/20 text-gray-300 border-gray-600"; // draft
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

function fmtDate(x: string | null) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return x;
  }
}

/** One labelled line in the "What you sent" header block. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-gray-500 w-20 shrink-0">{label}</dt>
      <dd className="text-gray-200 min-w-0 break-words">{value}</dd>
    </div>
  );
}
