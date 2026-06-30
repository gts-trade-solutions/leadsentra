"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Download,
  ShieldOff,
  Send,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import Instructions from "@/components/Instructions";

type Row = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  contact_id: string | null;
  contact_name: string | null;
  email: string;
  status: string;
  /** Per-recipient failure reason persisted by the send route on status='failed'. */
  error_reason: string | null;
  message_id: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  last_event_at: string | null;
  bounced_at: string | null;
  complaint_at: string | null;
  opens_count: number;
  clicks_count: number;
};

type Summary = {
  sent: number;
  delivered: number;
  opened_unique: number;
  clicked_unique: number;
  bounced: number;
  complained: number;
  suppressed: number;
  queued: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
};

type Status =
  | "all" | "queued" | "sent" | "delivered" | "opened" | "clicked"
  | "bounced" | "complained" | "suppressed" | "failed";

type CampaignOpt = { id: string; name: string; status: string; event_count: number };

// IMPORTANT: Use the LOCAL date, not UTC.  `toISOString()` returns UTC, which
// is the previous calendar day in IST (UTC+5:30) for half the day — causing
// "Today" to filter on yesterday's data.
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayIso() {
  return fmtLocal(new Date());
}
function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtLocal(d);
}
function startOfMonthIso() {
  const d = new Date();
  d.setDate(1);
  return fmtLocal(d);
}

const PRESETS = [
  { label: "Today",      from: () => todayIso(),        to: () => todayIso() },
  { label: "Yesterday",  from: () => daysAgoIso(1),     to: () => daysAgoIso(1) },
  { label: "Last 7d",    from: () => daysAgoIso(6),     to: () => todayIso() },
  { label: "Last 30d",   from: () => daysAgoIso(29),    to: () => todayIso() },
  { label: "This month", from: () => startOfMonthIso(), to: () => todayIso() },
];

const STATUS_CHIPS: { v: Status; label: string }[] = [
  { v: "all",        label: "All" },
  { v: "queued",     label: "Queued" },
  { v: "sent",       label: "Sent" },
  { v: "delivered",  label: "Delivered" },
  { v: "opened",     label: "Opened" },
  { v: "clicked",    label: "Clicked" },
  { v: "bounced",    label: "Bounced" },
  { v: "complained", label: "Complained" },
  { v: "suppressed", label: "Suppressed" },
  { v: "failed",     label: "Failed" },
];

const PER_PAGE = 100;

export default function Tracking() {
  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo]     = useState(todayIso());
  const [status, setStatus] = useState<Status>("all");
  const [campaignId, setCampaignId] = useState<string>("");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [campaigns, setCampaigns] = useState<CampaignOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const isPresetActive = (p: typeof PRESETS[number]) =>
    from === p.from() && to === p.to();

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/email-status", window.location.origin);
      if (from) url.searchParams.set("from", from);
      if (to)   url.searchParams.set("to", to);
      url.searchParams.set("status", status);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(PER_PAGE));
      if (search) url.searchParams.set("q", search);
      if (campaignId) url.searchParams.set("campaignId", campaignId);
      const res = await fetch(url.toString(), { credentials: "same-origin", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setCounts(data?.counts || {});
      setSummary(data?.summary || null);
      setTotal(Number(data?.total || 0));
    } finally {
      setLoading(false);
    }
  }, [from, to, status, campaignId, search, page]);

  const fetchCampaigns = useCallback(async () => {
    try {
      const url = new URL("/api/email-status/campaigns", window.location.origin);
      if (from) url.searchParams.set("from", from);
      if (to)   url.searchParams.set("to", to);
      const res = await fetch(url.toString(), { credentials: "same-origin", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
    } catch { /* ignore */ }
  }, [from, to]);

  // Debounce: reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [from, to, status, campaignId, search]);

  useEffect(() => {
    const t = setTimeout(fetchRows, 250);
    return () => clearTimeout(t);
  }, [fetchRows]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { fetchRows(); fetchCampaigns(); }, 30_000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchRows, fetchCampaigns]);

  function exportCsv() {
    const url = new URL("/api/email-status/export", window.location.origin);
    if (from) url.searchParams.set("from", from);
    if (to)   url.searchParams.set("to", to);
    url.searchParams.set("status", status);
    if (search) url.searchParams.set("q", search);
    if (campaignId) url.searchParams.set("campaignId", campaignId);
    window.location.href = url.toString();
  }

  const [suppressBusy, setSuppressBusy] = useState(false);

  /** Bulk-adds all bounced/complained recipients in the current filter to the
   *  suppression list.  Idempotent (INSERT IGNORE), safe to click repeatedly. */
  async function suppressBounced() {
    const target =
      status === "complained" ? "complained" :
      status === "failed"     ? "failed"     :
      "bounced";
    const label =
      target === "complained" ? "complained" :
      target === "failed"     ? "failed" :
      "bounced";
    if (!confirm(
      `Add all ${label} recipients in the current filter to the suppression list?\n\n` +
      `Future campaigns will skip them.  Already-suppressed addresses are ignored.`
    )) return;
    setSuppressBusy(true);
    try {
      const r = await fetch("/api/campaigns/mark-inactive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          status: target,
          from: from || undefined,
          to: to || undefined,
          campaign_id: campaignId || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed");
      alert(
        `Added ${j.suppressed} new suppressions.\n` +
        `${j.alreadySuppressed} were already on the list.\n` +
        `Scanned ${j.scanned} recipients.`
      );
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setSuppressBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const sentTotal = summary?.sent ?? 0;

  return (
    <AuthGuard>
      <div className="space-y-6">
        <SectionHeader
          title="Email Tracking"
          description="Per-recipient delivery, opens, clicks, bounces and complaints across every campaign"
        >
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
            title="Automatically refresh the table every 30 seconds"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors ${
              autoRefresh
                ? "bg-emerald-600/15 border-emerald-600 text-emerald-300"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
            }`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-gray-500"}`}
            />
            Auto-refresh (30s)
          </button>
          <button
            onClick={() => { fetchRows(); fetchCampaigns(); }}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={suppressBounced}
            disabled={suppressBusy}
            className="flex items-center gap-2 px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-60"
            title="Add every bounced / complained recipient (in current filter) to the suppression list"
          >
            <ShieldOff className="w-4 h-4" />
            {suppressBusy ? "Suppressing…" : "Suppress bounced"}
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <Link
            href="/portal/campaigns"
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </SectionHeader>

        <Instructions title="How filters compose" variant="info" defaultOpen={false}>
          <ul className="text-sm list-disc list-inside space-y-1">
            <li><b>Date range</b> bounds every other filter — based on when the recipient row was created (your send time).</li>
            <li><b>Campaign</b> scopes to one specific campaign.</li>
            <li><b>Status</b> filters by the most recent state of each recipient (<code>queued → sent → delivered → opened → clicked</code>; <code>bounced</code>/<code>complained</code>/<code>suppressed</code>/<code>failed</code> override).</li>
            <li><b>Search</b> matches against email and contact name.</li>
            <li><b>Suppressed</b> rows mean the address was on your <Link href="/portal/campaigns/suppressions" className="text-emerald-400 underline">suppression list</Link> — never sent, no credits charged.</li>
          </ul>
        </Instructions>

        {/* Quick presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setFrom(p.from()); setTo(p.to()); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isPresetActive(p)
                  ? "bg-emerald-600 border-emerald-500 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI
            label="Sent"
            value={sentTotal.toLocaleString("en-US")}
            sub={`${(summary?.delivered ?? 0).toLocaleString()} delivered`}
            icon={Send}
          />
          <KPI
            label="Open rate"
            value={sentTotal > 0 ? `${summary?.open_rate ?? 0}%` : "—"}
            sub={`${(summary?.opened_unique ?? 0).toLocaleString()} unique opens`}
            icon={Eye}
            valueClass="text-sky-300"
          />
          <KPI
            label="Click rate"
            value={sentTotal > 0 ? `${summary?.click_rate ?? 0}%` : "—"}
            sub={`${(summary?.clicked_unique ?? 0).toLocaleString()} unique clicks`}
            icon={MousePointerClick}
            valueClass="text-emerald-300"
          />
          <KPI
            label="Bounce rate"
            value={sentTotal > 0 ? `${summary?.bounce_rate ?? 0}%` : "—"}
            sub={
              <>
                {(summary?.bounced ?? 0).toLocaleString()} bounces ·{" "}
                {(summary?.complained ?? 0).toLocaleString()} complaints
              </>
            }
            icon={AlertTriangle}
            valueClass={(summary?.bounced ?? 0) > 0 ? "text-red-300" : "text-gray-300"}
          />
        </div>

        {/* Filter card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_2fr] gap-3">
            <div>
              <label htmlFor="trk-from" className="block text-xs text-gray-400 mb-1">From</label>
              <input
                id="trk-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              />
            </div>
            <div>
              <label htmlFor="trk-to" className="block text-xs text-gray-400 mb-1">To</label>
              <input
                id="trk-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              />
            </div>
            <div>
              <label htmlFor="trk-campaign" className="block text-xs text-gray-400 mb-1">Campaign</label>
              <select
                id="trk-campaign"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              >
                <option value="">All campaigns ({campaigns.length})</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.event_count} evt
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="trk-q" className="block text-xs text-gray-400 mb-1">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  id="trk-q"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Email or name…"
                  className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500"
                />
              </div>
            </div>
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-2 pt-1">
            {STATUS_CHIPS.map((s) => {
              const n = s.v === "all"
                ? Object.values(counts).reduce((a, b) => a + Number(b || 0), 0)
                : Number(counts[s.v] || 0);
              return (
                <button
                  key={s.v}
                  onClick={() => setStatus(s.v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                    status === s.v
                      ? "border-emerald-500 bg-emerald-600/20 text-emerald-300"
                      : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  {s.label}
                  <span className="text-[10px] font-mono opacity-80">
                    {n.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto rounded-xl border border-gray-800 bg-gray-900">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-gray-900/80 text-gray-400 uppercase tracking-wider text-xs">
              <tr>
                <th className="text-left px-3 py-2">Campaign</th>
                <th className="text-left px-3 py-2">Recipient</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Sent</th>
                <th className="text-left px-3 py-2">Opens</th>
                <th className="text-left px-3 py-2">Clicks</th>
                <th className="text-left px-3 py-2">Last event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-4 text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-4 text-gray-400">No matching recipients.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="text-gray-200">
                    <td className="px-3 py-2 max-w-[200px] truncate">
                      <Link
                        href={`/portal/campaigns/${r.campaign_id}`}
                        className="text-emerald-400 hover:underline"
                      >
                        {r.campaign_name || r.campaign_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[260px] truncate">
                      <div className="flex flex-col">
                        <span className="text-gray-300 text-sm">{r.contact_name || "—"}</span>
                        <span className="text-gray-500 text-xs">{r.email}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                      {/* Per-recipient failure reason — only persisted on
                          status='failed'.  Truncated with title so the user
                          can hover to read the full SES/provider error. */}
                      {r.status === "failed" && r.error_reason && (
                        <div
                          className="mt-1 text-[11px] text-rose-300/90 max-w-[200px] truncate"
                          title={r.error_reason}
                        >
                          {r.error_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{fmtDate(r.sent_at)}</td>
                    <td className="px-3 py-2">
                      {r.opens_count > 0 ? (
                        <div className="flex flex-col">
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
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1 text-indigo-300">
                            <MousePointerClick className="w-3.5 h-3.5" /> {r.clicks_count}
                          </span>
                          <span className="text-xs text-gray-500">{fmtDate(r.clicked_at)}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{fmtDate(r.last_event_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            Showing <b className="text-gray-200">{rows.length === 0 ? 0 : (page - 1) * PER_PAGE + 1}</b>
            {"–"}<b className="text-gray-200">{Math.min(page * PER_PAGE, total)}</b>{" "}
            of <b className="text-gray-200">{total.toLocaleString()}</b> recipients
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

function KPI({
  label, value, sub, icon: Icon, valueClass,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: any;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
        <Icon className="w-4 h-4 text-gray-500" />
      </div>
      <div className={`mt-2 text-2xl font-semibold ${valueClass || "text-white"}`}>
        {value}
      </div>
      {sub !== undefined && (
        <div className="mt-1 text-xs text-gray-500">{sub}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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
      : status === "failed"
      ? "bg-red-700/30 text-red-300 border-red-700"
      : "bg-gray-700/40 text-gray-300 border-gray-700"; // queued
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
