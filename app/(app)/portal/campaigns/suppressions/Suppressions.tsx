"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Trash2,
  Shield,
  Mail,
  Globe,
  Hand,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import StatCard from "@/components/StatCard";
import Table from "@/components/Table";
import EmptyState from "@/components/EmptyState";
import Instructions from "@/components/Instructions";
import { toast } from "@/hooks/use-toast";

type SuppressionRow = {
  id: number;
  type: "email" | "domain";
  value: string;
  reason: string | null;
  source: string;
  corrected: number | boolean | null;
  corrected_at: string | null;
  created_at: string;
};

type Summary = { total: number; emails: number; domains: number; manual: number };

type FilterType = "all" | "email" | "domain";
// `corrected` is not a real `source` column value — it's a parallel pseudo-tab
// meaning "rows where corrected=1, regardless of source".  Handled specially
// in load() so the API gets `corrected=true` instead of `source=corrected`.
type FilterSource = "all" | "manual" | "bounce" | "complaint" | "unsubscribe" | "import" | "corrected";

const PER_PAGE = 50;

const SOURCE_BADGE: Record<string, string> = {
  manual:       "bg-gray-700/40 text-gray-200 border-gray-600",
  bounce:       "bg-red-600/20 text-red-300 border-red-700",
  complaint:    "bg-amber-600/20 text-amber-300 border-amber-700",
  unsubscribe:  "bg-violet-600/20 text-violet-300 border-violet-700",
  import:       "bg-sky-600/20 text-sky-300 border-sky-700",
};

export default function SuppressionsPage() {
  const [rows, setRows] = useState<SuppressionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary>({ total: 0, emails: 0, domains: 0, manual: 0 });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterSource, setFilterSource] = useState<FilterSource>("all");
  const [page, setPage] = useState(1);

  // Bulk-add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkSource, setBulkSource] = useState<FilterSource>("manual");
  const [bulkReason, setBulkReason] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Edit modal
  const [editing, setEditing] = useState<SuppressionRow | null>(null);
  const [editForm, setEditForm] = useState<{
    type: "email" | "domain";
    value: string;
    reason: string;
    source: string;
    corrected: boolean;
  }>({ type: "email", value: "", reason: "", source: "manual", corrected: false });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  function openEdit(row: SuppressionRow) {
    setEditing(row);
    setEditForm({
      type: row.type,
      value: row.value,
      reason: row.reason ?? "",
      source: row.source,
      corrected: !!row.corrected,
    });
    setEditErr(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const v = editForm.value.trim();
    if (!v) { setEditErr("Value is required"); return; }
    setEditBusy(true);
    setEditErr(null);
    try {
      const res = await fetch(`/api/suppressions/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          type: editForm.type,
          value: v,
          reason: editForm.reason.trim() || null,
          source: editForm.source,
          corrected: editForm.corrected,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Update failed");

      // If we just marked the row corrected (it wasn't before), auto-switch
      // to the Corrected tab so the user immediately sees where the row went.
      // Otherwise they'd stay on the Bounce/Complaint tab and the row would
      // just disappear, which feels broken.
      const becameCorrected = !editing?.corrected && editForm.corrected;
      const becameUncorrected = !!editing?.corrected && !editForm.corrected;
      if (becameCorrected) {
        toast({
          title: "Marked as corrected",
          description: "Moved to the Corrected tab — campaigns can deliver here again.",
        });
        setFilterSource("corrected");
        setPage(1);
      } else if (becameUncorrected) {
        toast({
          title: "Re-suppressed",
          description: "Back on the active suppression list.",
        });
      } else {
        toast({ title: "Suppression updated" });
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      setEditErr(e?.message || "Update failed");
    } finally {
      setEditBusy(false);
    }
  }

  /** Quick one-click toggle from the row's inline ✓ Corrected pill. */
  async function toggleCorrected(row: SuppressionRow) {
    const next = !row.corrected;
    try {
      const res = await fetch(`/api/suppressions/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ corrected: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Update failed");
      }
      toast({
        title: next ? "Marked as corrected" : "Re-suppressed",
        description: next
          ? "Moved to the Corrected tab — campaigns can deliver here again."
          : "Back on the active suppression list.",
      });
      // Same auto-switch behavior as the modal save: jump to the tab where
      // the row now lives so it's visible.
      if (next) {
        setFilterSource("corrected");
        setPage(1);
      }
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message || "" });
    }
  }

  async function load() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PER_PAGE));
      if (search.trim()) params.set("q", search.trim());
      if (filterType !== "all") params.set("type", filterType);
      // "Corrected" chip → only corrected rows, regardless of source.
      // Real source chips (Bounce / Complaint / Manual / ...) → that source,
      // and ONLY active rows (corrected hidden) so a fixed bounce doesn't
      // show up in both Bounce and Corrected.
      if (filterSource === "corrected") {
        params.set("corrected", "true");
      } else if (filterSource !== "all") {
        params.set("source", filterSource);
        params.set("corrected", "false");
      }
      const res = await fetch(`/api/suppressions?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setRows(data.rows ?? []);
      setTotal(Number(data.total ?? 0));
      setSummary(data.summary ?? { total: 0, emails: 0, domains: 0, manual: 0 });
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // Reload on any filter/page/search change (debounced for search)
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterType, filterSource, page]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, filterType, filterSource]);

  function parseBulk(input: string): string[] {
    return input
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  async function onBulkAdd() {
    setAddErr(null);
    const tokens = parseBulk(bulkText);
    if (!tokens.length) {
      setAddErr("Paste at least one email or domain.");
      return;
    }
    setAddBusy(true);
    try {
      const entries = tokens.map((value) => ({
        value,
        source: bulkSource,
        reason: bulkReason.trim() || null,
      }));
      const res = await fetch("/api/suppressions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ entries }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data?.added) {
        setAddErr(data?.error || "Bulk add failed");
        return;
      }
      const added = Number(data?.added || 0);
      const dups = Number(data?.duplicates || 0);
      const skipped = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      toast({
        title: `Added ${added} suppression${added === 1 ? "" : "s"}`,
        description: [
          dups ? `${dups} already on list` : null,
          skipped ? `${skipped} skipped (invalid)` : null,
        ].filter(Boolean).join(" · "),
      });
      setBulkText("");
      setBulkReason("");
      setShowAdd(false);
      setPage(1);
      await load();
    } catch (e: any) {
      setAddErr(e?.message || "Bulk add failed");
    } finally {
      setAddBusy(false);
    }
  }

  async function doDelete(id: number) {
    try {
      const res = await fetch(`/api/suppressions/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toast({ title: "Suppression removed" });
      setConfirmDeleteId(null);
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message || "" });
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const tableData = useMemo(
    () =>
      rows.map((r) => ({
        type: (
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${
              r.type === "email"
                ? "bg-sky-600/15 text-sky-300 border-sky-700/50"
                : "bg-violet-600/15 text-violet-300 border-violet-700/50"
            }`}
          >
            {r.type === "email" ? <Mail className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
            {r.type}
          </span>
        ),
        value: (
          <span className="font-mono text-sm text-gray-200 break-all">{r.value}</span>
        ),
        reason: <span className="text-sm text-gray-300">{r.reason || "—"}</span>,
        source: (
          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border ${
                SOURCE_BADGE[r.source] || SOURCE_BADGE.manual
              }`}
            >
              {r.source}
            </span>
            {/* When corrected, show a green pill inline so the user sees at a
                glance that this row was reviewed and is no longer blocking
                delivery.  Click the pill to undo (re-suppress). */}
            {r.corrected ? (
              <button
                type="button"
                onClick={() => toggleCorrected(r)}
                title={`Corrected on ${fmtDate(r.corrected_at || "")}. Click to re-suppress.`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border bg-emerald-700/20 border-emerald-700 text-emerald-200 hover:bg-emerald-700/30 transition-colors"
              >
                ✓ Corrected
              </button>
            ) : null}
          </div>
        ),
        created: (
          <span className="text-xs text-gray-400">{fmtDate(r.created_at)}</span>
        ),
        actions: (
          <div className="flex items-center gap-1.5">
            {/* Quick "Mark corrected" button for active rows — one click,
                no modal needed.  Auto-switches to the Corrected tab. */}
            {!r.corrected && (
              <button
                onClick={() => toggleCorrected(r)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-emerald-800 bg-emerald-900/30 hover:bg-emerald-700/40 hover:border-emerald-600 text-emerald-200 whitespace-nowrap"
                title="Mark this address as corrected — moves it to the Corrected tab and allows future campaigns to deliver to it"
              >
                ✓ Mark corrected
              </button>
            )}
            <button
              onClick={() => openEdit(r)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-sky-900/40 hover:border-sky-700 text-gray-200 hover:text-sky-200 whitespace-nowrap"
              title="Edit this suppression"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={() => setConfirmDeleteId(r.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:bg-red-900/40 hover:border-red-700 text-gray-200 hover:text-red-200 whitespace-nowrap"
              title="Remove from suppression list"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );

  const tokenCount = useMemo(() => parseBulk(bulkText).length, [bulkText]);

  return (
    <AuthGuard>
      <div className="space-y-6">
        <SectionHeader
          title="Suppressions"
          description={
            total === 0
              ? "Manage blocked emails and domains for email campaigns"
              : `${summary.total.toLocaleString()} address${summary.total === 1 ? "" : "es"} blocked from receiving campaigns`
          }
        >
          <button
            onClick={() => {
              setAddErr(null);
              setShowAdd(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Suppression
          </button>
        </SectionHeader>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard title="Total Suppressed" value={summary.total.toLocaleString("en-US")} icon={Shield} />
          <StatCard title="Emails"           value={summary.emails.toLocaleString("en-US")}  icon={Mail} />
          <StatCard title="Domains"          value={summary.domains.toLocaleString("en-US")} icon={Globe} />
          <StatCard title="Manual Blocks"    value={summary.manual.toLocaleString("en-US")}  icon={Hand} />
        </div>

        {/* Automation explainer */}
        <Instructions
          title="Automation status — how addresses end up here"
          variant="success"
          defaultOpen={total === 0}
        >
          <p>
            The suppression list runs automatically. You don&apos;t need to manage it manually unless you want to.
          </p>
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/80 text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Trigger</th>
                  <th className="text-left px-3 py-2">What gets recorded</th>
                  <th className="text-left px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                <tr>
                  <td className="px-3 py-2 text-gray-200"><b>Hard bounce</b></td>
                  <td className="px-3 py-2 text-gray-300">SES SNS webhook marks the address as permanent bounce → auto-suppressed.</td>
                  <td className="px-3 py-2"><SourceBadge source="bounce" /></td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-200"><b>Spam complaint</b></td>
                  <td className="px-3 py-2 text-gray-300">Recipient hits &ldquo;Mark as spam&rdquo;. Webhook auto-suppresses them.</td>
                  <td className="px-3 py-2"><SourceBadge source="complaint" /></td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-200"><b>Unsubscribe link</b></td>
                  <td className="px-3 py-2 text-gray-300">Recipient clicks the unsubscribe link in your campaign email.</td>
                  <td className="px-3 py-2"><SourceBadge source="unsubscribe" /></td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-200"><b>CSV import</b></td>
                  <td className="px-3 py-2 text-gray-300">Pasted via the &ldquo;Add Suppression&rdquo; button using <code>import</code> source.</td>
                  <td className="px-3 py-2"><SourceBadge source="import" /></td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-200"><b>Manual</b></td>
                  <td className="px-3 py-2 text-gray-300">You explicitly add a single email or domain here.</td>
                  <td className="px-3 py-2"><SourceBadge source="manual" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Every campaign send goes through this list <b className="text-gray-200">before</b> SES is called — suppressed addresses are
            never charged or delivered to.
          </p>
        </Instructions>

        {/* Toolbar: search + filters */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-3">
            <div>
              <label htmlFor="supp-search" className="block text-xs text-gray-400 mb-1">
                Search
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  id="supp-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by value or reason…"
                  aria-label="Search suppressions"
                  className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div>
              <label htmlFor="supp-filter-type" className="block text-xs text-gray-400 mb-1">
                Type
              </label>
              <select
                id="supp-filter-type"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
              >
                <option value="all">All types</option>
                <option value="email">Email</option>
                <option value="domain">Domain</option>
              </select>
            </div>
          </div>

          {/* Source filter chips.  "Corrected" is a pseudo-source meaning
              "rows the admin reviewed and re-enabled for delivery". */}
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-xs text-gray-400 self-center mr-1">Source:</span>
            {(["all", "manual", "bounce", "complaint", "unsubscribe", "import", "corrected"] as FilterSource[]).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSource(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filterSource === s
                    ? // Corrected uses a slightly different accent so it's
                      // visually distinct from the active "source" chips.
                      s === "corrected"
                        ? "bg-emerald-700/40 border-emerald-500 text-emerald-100"
                        : "bg-emerald-600 border-emerald-500 text-white"
                    : s === "corrected"
                    ? "bg-gray-800 border-emerald-800/60 text-emerald-300 hover:border-emerald-600"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table or empty state */}
        {errorMsg ? (
          <div className="rounded-lg border border-red-700 bg-red-900/20 p-4 text-sm text-red-200">
            {errorMsg}
          </div>
        ) : loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="No suppressions yet"
            description={
              search.trim() || filterType !== "all" || filterSource !== "all"
                ? "No matches. Adjust your search or filters."
                : "Hard bounces and complaints from SES will appear here automatically. You can also add entries by hand."
            }
            primary={{
              label: "Add Suppression",
              onClick: () => { setAddErr(null); setShowAdd(true); },
            }}
          />
        ) : (
          <>
            <Table
              headers={["Type", "Value", "Reason", "Source", "Created", "Actions"]}
              data={tableData}
            />
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="text-xs text-gray-400">
                  Showing{" "}
                  <b className="text-gray-200">{(page - 1) * PER_PAGE + 1}</b>
                  {"–"}
                  <b className="text-gray-200">{Math.min(page * PER_PAGE, total)}</b>{" "}
                  of <b className="text-gray-200">{total.toLocaleString()}</b>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-3 text-sm text-gray-200">
                    Page <b>{page}</b> / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Bulk Add modal */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-xl">
              <div className="p-5 border-b border-gray-800">
                <h2 className="text-lg font-semibold text-white">Add to suppression list</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Paste one or many — emails and domains are detected automatically. Duplicates are skipped silently.
                </p>
              </div>
              <div className="p-5 space-y-4">
                {addErr && (
                  <div className="text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
                    {addErr}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="supp-bulk-source" className="block text-sm text-gray-300 mb-1">
                      Source
                    </label>
                    <select
                      id="supp-bulk-source"
                      value={bulkSource}
                      onChange={(e) => setBulkSource(e.target.value as FilterSource)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                    >
                      <option value="manual">manual</option>
                      <option value="import">import</option>
                      <option value="unsubscribe">unsubscribe</option>
                      <option value="bounce">bounce</option>
                      <option value="complaint">complaint</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="supp-bulk-reason" className="block text-sm text-gray-300 mb-1">
                      Reason <span className="text-gray-500">(optional)</span>
                    </label>
                    <input
                      id="supp-bulk-reason"
                      type="text"
                      value={bulkReason}
                      onChange={(e) => setBulkReason(e.target.value)}
                      placeholder="e.g. cleanup, hard bounce campaign #14"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="supp-bulk-text" className="block text-sm text-gray-300 mb-1">
                    Emails &amp; domains{" "}
                    <span className="text-gray-500 text-xs">(one per line, comma or semicolon-separated — detected automatically)</span>
                  </label>
                  <textarea
                    id="supp-bulk-text"
                    rows={8}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={"user@example.com\nanother@example.com\ncompetitor.com\n@spammers.io"}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                  />
                  {tokenCount > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      {tokenCount} entr{tokenCount === 1 ? "y" : "ies"} detected.
                    </p>
                  )}
                </div>
              </div>
              <div className="p-5 border-t border-gray-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  disabled={addBusy}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onBulkAdd}
                  disabled={addBusy || tokenCount === 0}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                >
                  {addBusy ? "Adding…" : `Add ${tokenCount || ""}`.trim()}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {confirmDeleteId !== null && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md p-5">
              <h2 className="text-lg font-semibold text-white">Remove suppression?</h2>
              <p className="text-sm text-gray-400 mt-2">
                Future campaigns will be allowed to send to this recipient again. Be careful when removing a hard-bounced
                address — re-mailing it damages your sending reputation.
              </p>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-gray-700 bg-gray-800 text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => doDelete(confirmDeleteId!)}
                  className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit suppression modal */}
        {editing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md">
              <div className="px-5 pt-5 pb-3 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Edit suppression</h2>
                <SourceBadge source={editing.source} />
              </div>
              <div className="px-5 py-4 space-y-3">
                {editErr && (
                  <div className="text-sm text-red-300 border border-red-700/50 bg-red-950/40 rounded-md px-3 py-2">
                    {editErr}
                  </div>
                )}

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Type</label>
                  <select
                    value={editForm.type}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, type: e.target.value as "email" | "domain" }))
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  >
                    <option value="email">Email</option>
                    <option value="domain">Domain</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    {editForm.type === "email" ? "Email address" : "Domain"}
                  </label>
                  <input
                    type="text"
                    value={editForm.value}
                    onChange={(e) => setEditForm((f) => ({ ...f, value: e.target.value }))}
                    placeholder={editForm.type === "email" ? "name@example.com" : "example.com"}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Source</label>
                  <select
                    value={editForm.source}
                    onChange={(e) => setEditForm((f) => ({ ...f, source: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  >
                    <option value="manual">manual</option>
                    <option value="bounce">bounce</option>
                    <option value="complaint">complaint</option>
                    <option value="unsubscribe">unsubscribe</option>
                    <option value="import">import</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Reason / note (optional)</label>
                  <input
                    type="text"
                    value={editForm.reason}
                    onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="e.g. hard bounce — invalid mailbox"
                    maxLength={255}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
                  />
                </div>

                {/* Corrected toggle — when ON, this address can receive mail again. */}
                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editForm.corrected}
                    onChange={(e) => setEditForm((f) => ({ ...f, corrected: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-700 bg-gray-800 accent-emerald-500"
                  />
                  <span className="text-sm text-gray-200">
                    Mark as <b className="text-emerald-300">corrected</b> — keep the row for audit, but allow future campaigns to deliver to this address again
                  </span>
                </label>
              </div>
              <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-3 bg-gray-900 rounded-b-2xl">
                <button
                  onClick={() => setEditing(null)}
                  disabled={editBusy}
                  className="px-4 py-2 rounded-lg text-sm border border-gray-700 bg-gray-800 text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={editBusy}
                  className="px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                >
                  {editBusy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

function SourceBadge({ source }: { source: string }) {
  const cls = SOURCE_BADGE[source] || SOURCE_BADGE.manual;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border ${cls}`}>
      {source}
    </span>
  );
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return s;
  }
}
