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
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import StatCard from "@/components/StatCard";
import { toast } from "@/hooks/use-toast";

type RecipientRow = {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  contact_name: string | null;
  email: string;
  status: string;
  message_id: string | null;
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

type Filter =
  | "all" | "delivered" | "opened" | "clicked"
  | "bounced" | "complained" | "not_opened" | "suppressed";

const PER_PAGE = 100;

export default function TrackingPage({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);

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

      // Campaign summary (from the list endpoint)
      const listRes = await fetch("/api/campaigns", { credentials: "same-origin" });
      const listJson = await listRes.json().catch(() => ({}));
      const summary = (Array.isArray(listJson?.campaigns) ? listJson.campaigns : [])
        .find((c: CampaignSummary) => c.id === campaignId);
      if (summary) setCampaign(summary);
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

  const stats = useMemo(() => {
    let total = rows.length;
    let delivered = 0, bounced = 0, complained = 0, openedUnique = 0;
    let opens = 0, clicks = 0, suppressed = 0, queued = 0, sent = 0;
    for (const r of rows) {
      if (r.status === "delivered") delivered++;
      if (r.status === "bounced") bounced++;
      if (r.status === "complained") complained++;
      if (r.status === "suppressed") suppressed++;
      if (r.status === "queued") queued++;
      if (r.status === "sent") sent++;
      if (r.opened_at) openedUnique++;
      opens += r.opens_count || 0;
      clicks += r.clicks_count || 0;
    }
    return { total, delivered, bounced, complained, openedUnique, opens, clicks, suppressed, queued, sent };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const m =
        filter === "all" ||
        (filter === "delivered" && r.status === "delivered") ||
        (filter === "opened" && !!r.opened_at) ||
        (filter === "clicked" && !!r.clicked_at) ||
        (filter === "bounced" && r.status === "bounced") ||
        (filter === "complained" && r.status === "complained") ||
        (filter === "suppressed" && r.status === "suppressed") ||
        (filter === "not_opened" && !r.opened_at && (r.status === "sent" || r.status === "delivered"));
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
          <label className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (15s)
          </label>
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
          <StatCard title="Recipients"      value={String(stats.total)}        icon={Mail} />
          <StatCard title="Delivered"       value={String(stats.delivered)}    icon={CheckCircle2} />
          <StatCard title="Opened (unique)" value={String(stats.openedUnique)} icon={Eye} />
          <StatCard title="Opens"           value={String(stats.opens)}        icon={Eye} />
          <StatCard title="Clicks"          value={String(stats.clicks)}       icon={MousePointerClick} />
          <StatCard
            title="Bounced / Compl."
            value={String(stats.bounced + stats.complained)}
            icon={AlertTriangle}
          />
        </div>

        {/* Secondary stats row */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs text-gray-400 flex flex-wrap gap-x-6 gap-y-1">
          <span><b className="text-gray-200">{stats.sent}</b> sent</span>
          <span><b className="text-gray-200">{stats.queued}</b> queued</span>
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
                    <td className="px-3 py-2"><RecipientStatus status={r.status} /></td>
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
