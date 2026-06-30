"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCcw,
  ChevronDown,
  ChevronRight,
  Building2,
  Send,
  Eye,
  Reply,
  MailWarning,
} from "lucide-react";
import SectionHeader from "@/components/SectionHeader";
import EmptyState from "@/components/EmptyState";

type Campaign = {
  campaign_id: string;
  campaign_name: string;
  sent_at: string | null;
  recipients: number;
  opened: number;
  clicked: number;
};

type Company = {
  company_id: string;
  company_name: string;
  campaigns_sent: number;
  recipients: number;
  opened: number;
  clicked: number;
  responded: number;
  last_sent: string | null;
  last_reply: string | null;
  campaigns: Campaign[];
};

type Payload = {
  companies: Company[];
  totals: { companies: number; campaigns: number; recipients: number; responded: number };
  mailboxConnected: boolean;
  repliesChecked: boolean;
  repliesError: string | null;
};

export default function OfferAnalytics() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/outreach", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load analytics");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const companies = data?.companies || [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Offer Analytics"
        description="Which companies you sent offers to, how they engaged, and who responded."
      >
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </SectionHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Companies contacted" value={data?.totals.companies ?? "—"} icon={<Building2 className="w-4 h-4" />} />
        <Stat label="Offers / campaigns sent" value={data?.totals.campaigns ?? "—"} icon={<Send className="w-4 h-4" />} />
        <Stat label="Total recipients" value={data?.totals.recipients ?? "—"} icon={<Eye className="w-4 h-4" />} />
        <Stat label="Companies responded" value={data?.totals.responded ?? "—"} icon={<Reply className="w-4 h-4" />} />
      </div>

      {/* Reply-tracking notice */}
      {data && !data.mailboxConnected && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100 flex items-start gap-2">
          <MailWarning className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Reply tracking is off because no mailbox is connected.{" "}
            <Link href="/portal/inbox" className="underline text-amber-200 hover:text-white">
              Connect your inbox
            </Link>{" "}
            to see which companies replied.
          </span>
        </div>
      )}
      {data?.repliesError && (
        <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          Couldn&apos;t check replies: {data.repliesError}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">Loading…</div>
      ) : error ? (
        <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 p-6 text-sm text-rose-200">{error}</div>
      ) : companies.length === 0 ? (
        <EmptyState
          title="No offers sent yet"
          description="Once you send catalogues or offers, you'll see per-company engagement and replies here."
          primary={{ label: "Go to Catalogues & Offers", onClick: () => router.push("/portal/catalogues") }}
        />
      ) : (
        <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-800 text-gray-400">
                  <th className="py-3 px-4 font-medium">Company</th>
                  <th className="py-3 px-3 font-medium text-center">Offers sent</th>
                  <th className="py-3 px-3 font-medium text-center">Recipients</th>
                  <th className="py-3 px-3 font-medium text-center">Opened</th>
                  <th className="py-3 px-3 font-medium text-center">Clicked</th>
                  <th className="py-3 px-3 font-medium text-center">Responded</th>
                  <th className="py-3 px-3 font-medium">Last sent</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const open = expanded.has(c.company_id);
                  return (
                    <CompanyRows
                      key={c.company_id}
                      company={c}
                      open={open}
                      onToggle={() => toggle(c.company_id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyRows({
  company: c,
  open,
  onToggle,
}: {
  company: Company;
  open: boolean;
  onToggle: () => void;
}) {
  const openRate = c.recipients ? Math.round((c.opened / c.recipients) * 100) : 0;
  return (
    <>
      <tr className="border-b border-gray-800/70 hover:bg-gray-800/40">
        <td className="py-3 px-4">
          <button onClick={onToggle} className="flex items-center gap-2 text-left">
            {open ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            )}
            <span className="text-white font-medium">{c.company_name}</span>
          </button>
        </td>
        <td className="py-3 px-3 text-center text-gray-200">{c.campaigns_sent}</td>
        <td className="py-3 px-3 text-center text-gray-200">{c.recipients}</td>
        <td className="py-3 px-3 text-center">
          <span className="text-gray-200">{c.opened}</span>
          <span className="text-gray-500 text-xs"> ({openRate}%)</span>
        </td>
        <td className="py-3 px-3 text-center text-gray-200">{c.clicked}</td>
        <td className="py-3 px-3 text-center">
          {c.responded > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-900/40 text-emerald-200 border border-emerald-700">
              <Reply className="w-3 h-3" />
              {c.responded}
            </span>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </td>
        <td className="py-3 px-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(c.last_sent)}</td>
      </tr>
      {open && (
        <tr className="bg-gray-950/40">
          <td colSpan={7} className="px-4 py-3">
            <div className="text-xs text-gray-400 mb-2">
              Offers / campaigns sent to <b className="text-gray-200">{c.company_name}</b>
              {c.last_reply && (
                <span className="ml-2 text-emerald-300">· last reply {fmtDate(c.last_reply)}</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-1.5 pr-4 font-medium">Offer / campaign</th>
                    <th className="py-1.5 px-3 font-medium text-center">Recipients</th>
                    <th className="py-1.5 px-3 font-medium text-center">Opened</th>
                    <th className="py-1.5 px-3 font-medium text-center">Clicked</th>
                    <th className="py-1.5 px-3 font-medium">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {c.campaigns.map((cp) => (
                    <tr key={cp.campaign_id} className="border-t border-gray-800/60">
                      <td className="py-1.5 pr-4 text-gray-200">
                        <Link
                          href={`/portal/campaigns/${cp.campaign_id}`}
                          className="text-emerald-400 hover:underline"
                        >
                          {cp.campaign_name}
                        </Link>
                      </td>
                      <td className="py-1.5 px-3 text-center text-gray-300">{cp.recipients}</td>
                      <td className="py-1.5 px-3 text-center text-gray-300">{cp.opened}</td>
                      <td className="py-1.5 px-3 text-center text-gray-300">{cp.clicked}</td>
                      <td className="py-1.5 px-3 text-gray-400 whitespace-nowrap">{fmtDate(cp.sent_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="text-emerald-400">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
