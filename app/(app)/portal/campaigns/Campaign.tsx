"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Mail,
  Eye,
  MousePointerClick,
  BarChart3,
  RefreshCcw,
  ShieldOff,
  LineChart,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import Table from "@/components/Table";
import StatCard from "@/components/StatCard";
import WalletBadge from "@/components/WalletBadge";
import EmptyState from "@/components/EmptyState";
import { emptyStats, type CampaignStats } from "@/lib/campaignStats";

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  /** Sent in "Primary inbox" mode — no open pixel, no click rewrites. */
  low_signal?: number | boolean;
};

/** Shape of one entry in POST /api/campaigns/metrics — see lib/campaignStats. */
type CampaignMetric = CampaignStats;

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campMetrics, setCampMetrics] = useState<Record<string, CampaignMetric>>({});
  const [loading, setLoading] = useState(true);

  async function loadCampaigns() {
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshMetrics() {
    const ids = campaigns.map((c) => c.id);
    if (!ids.length) return;
    try {
      const res = await fetch("/api/campaigns/metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      setCampMetrics(data?.metrics ?? {});
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  // Refresh the campaign list whenever the user returns to this tab/page.
  // Catches the common flow: user creates a new campaign in another tab,
  // comes back here, and expects to see it. Without this, the list shows
  // a stale snapshot from when the component first mounted.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        loadCampaigns();
      }
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Poll for fresh metrics every 5s while there are sending campaigns
  useEffect(() => {
    if (!campaigns.length) return;
    refreshMetrics();
    const anySending = campaigns.some((c) => c.status === "sending");
    if (!anySending) return;
    const t = setInterval(refreshMetrics, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  const totals = useMemo(
    () =>
      Object.values(campMetrics).reduce(
        (acc, m) => {
          // "Sent" is what we actually handed to the provider. It used to be
          // `recipients - queued`, which also swept in suppressed rows that
          // were deliberately never sent — inflating this tile above the count
          // in the SES console.
          acc.sent += m.attempted;
          acc.delivered += m.accepted;
          acc.opens += m.opens_total;
          acc.clicks += m.clicks_total;
          acc.bounced += m.bounced;
          return acc;
        },
        { sent: 0, delivered: 0, opens: 0, clicks: 0, bounced: 0 }
      ),
    [campMetrics]
  );
  const activeCount = campaigns.filter((c) => c.status === "sending" || c.status === "scheduled").length;

  const tableData = campaigns.map((c) => {
    const m = campMetrics[c.id] ?? emptyStats();
    const sentCount = m.attempted;
    // A campaign sent in Primary-inbox mode carries no pixel and no rewritten
    // links, so its opens and clicks can only ever be zero. Printing "0" reads
    // as "nobody opened it" — say that it wasn't measured instead.
    const untracked = !!Number(c.low_signal);
    const notTracked = (
      <span
        className="text-gray-500"
        title="Sent in Primary-inbox mode: opens and clicks aren't tracked for this campaign."
      >
        off
      </span>
    );
    return {
      name: <span className="font-medium text-white">{c.name}</span>,
      status: <StatusBadge status={c.status} />,
      sent: sentCount.toLocaleString("en-US"),
      delivered: m.accepted.toLocaleString("en-US"),
      opens: untracked ? notTracked : m.opens_total.toLocaleString("en-US"),
      clicks: untracked ? notTracked : m.clicks_total.toLocaleString("en-US"),
      bounced: m.bounced.toLocaleString("en-US"),
      details: (
        <Link
          href={`/portal/campaigns/${c.id}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 whitespace-nowrap"
        >
          <BarChart3 className="w-3.5 h-3.5" /> View
        </Link>
      ),
    };
  });

  return (
    <AuthGuard>
      <div className="space-y-6">
        <SectionHeader
          title="Email Campaigns"
          description="Create, send, and track your campaigns"
        >
          <WalletBadge />
          <Link
            href="/portal/campaigns/tracking"
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            title="See all delivery / open / click events across campaigns"
          >
            <LineChart className="w-4 h-4" /> Tracking
          </Link>
          <Link
            href="/portal/campaigns/suppressions"
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            title="Manage blocked emails and domains"
          >
            <ShieldOff className="w-4 h-4" /> Suppressions
          </Link>
          <button
            onClick={() => { loadCampaigns(); refreshMetrics(); }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            title="Refresh"
          >
            <RefreshCcw className="w-4 h-4" /> Refresh
          </button>
          <Link
            href="/portal/campaigns/new"
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Campaign
          </Link>
        </SectionHeader>

        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard title="Active"     value={String(activeCount)} icon={Mail} />
          <StatCard title="Total Sent" value={totals.sent.toLocaleString("en-US")}     icon={Mail} />
          <StatCard title="Delivered"  value={totals.delivered.toLocaleString("en-US")} icon={Mail} />
          <StatCard title="Opens"      value={totals.opens.toLocaleString("en-US")}     icon={Eye} />
          <StatCard title="Clicks"     value={totals.clicks.toLocaleString("en-US")}    icon={MousePointerClick} />
        </div>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No campaigns yet"
            description="Create your first campaign to start sending emails to your unlocked contacts."
            primary={{
              label: "Create Campaign",
              onClick: () => { window.location.href = "/portal/campaigns/new"; },
            }}
            secondary={{
              label: "Manage Suppressions",
              onClick: () => { window.location.href = "/portal/campaigns/suppressions"; },
            }}
          />
        ) : (
          <Table
            headers={["Campaign Name", "Status", "Sent", "Delivered", "Opens", "Clicks", "Bounced", "Details"]}
            data={tableData}
          />
        )}
      </div>
    </AuthGuard>
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
      : status === "suppressed"
      ? "bg-orange-600/20 text-orange-300 border-orange-700"
      : "bg-gray-600/20 text-gray-300 border-gray-600"; // draft / unknown
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}
