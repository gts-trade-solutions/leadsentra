"use client";
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import {
  Mail,
  MailMinus,
  RefreshCcw,
  Search,
  Settings2,
  Reply,
  Paperclip,
  Plug,
  ArrowLeft,
  Send,
} from "lucide-react";
import SectionHeader from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";

type Account = {
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  username: string;
  from_name: string | null;
};

type MsgListItem = {
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  date: string | null;
  seen: boolean;
};

type MsgFull = {
  uid: number;
  subject: string;
  fromName: string;
  fromAddress: string;
  to: string;
  date: string | null;
  html: string;
  text: string;
  attachments: { filename: string; size: number; contentType: string }[];
};

type ResponseItem = {
  email: string;
  opened: boolean;
  clicked: boolean;
  clicks: number;
  replied: boolean;
  reply: { uid: number; subject: string; date: string | null } | null;
  campaign: { id: string; name: string | null; subject: string | null } | null;
  last_at: string | null;
};

export default function InboxPage() {
  const [connected, setConnected] = useState<boolean | null>(null); // null = loading
  const [account, setAccount] = useState<Account | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [folders, setFolders] = useState<{ path: string; name: string; specialUse: string | null }[]>([]);
  const [mailbox, setMailbox] = useState("INBOX");

  const [messages, setMessages] = useState<MsgListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<MsgFull | null>(null);
  const [msgLoading, setMsgLoading] = useState(false);

  // "Responses" view: replies + reactions (opens/clicks) to sent offers/catalogues.
  const [view, setView] = useState<"mailbox" | "responses">("mailbox");
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [respLoading, setRespLoading] = useState(false);
  const [respError, setRespError] = useState<string | null>(null);
  const [respMailboxConnected, setRespMailboxConnected] = useState(true);

  const loadResponses = useCallback(async () => {
    setRespLoading(true);
    setRespError(null);
    try {
      const res = await fetch("/api/mail/responses", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load responses");
      setResponses(Array.isArray(json?.responses) ? json.responses : []);
      setRespMailboxConnected(json?.mailboxConnected !== false);
    } catch (e: any) {
      setRespError(e?.message || "Failed to load responses");
      setResponses([]);
    } finally {
      setRespLoading(false);
    }
  }, []);

  // Open a reply (always lives in INBOX) into the shared reader pane.
  async function openReply(uid: number) {
    setMsgLoading(true);
    setSelected(null);
    try {
      const res = await fetch(`/api/mail/messages/${uid}?mailbox=INBOX`, { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to open reply");
      setSelected(json.message);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not open reply", description: e?.message });
    } finally {
      setMsgLoading(false);
    }
  }

  // ---- account ----
  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/mail/account", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      setConnected(!!json?.connected);
      setAccount(json?.account || null);
      return !!json?.connected;
    } catch {
      setConnected(false);
      return false;
    }
  }, []);

  const loadMessages = useCallback(async (q = "", mb = "INBOX") => {
    setListLoading(true);
    setListError(null);
    try {
      const u = new URL("/api/mail/messages", window.location.origin);
      u.searchParams.set("limit", "50");
      u.searchParams.set("mailbox", mb);
      if (q.trim()) u.searchParams.set("search", q.trim());
      const res = await fetch(u.toString(), { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load messages");
      setMessages(Array.isArray(json?.messages) ? json.messages : []);
    } catch (e: any) {
      setListError(e?.message || "Failed to load messages");
      setMessages([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/mail/folders", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      setFolders(Array.isArray(json?.folders) ? json.folders : []);
    } catch {
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const ok = await loadAccount();
      if (ok) {
        loadFolders();
        loadMessages("", "INBOX");
      }
    })();
  }, [loadAccount, loadMessages, loadFolders]);

  // Switch to a different folder: reset the open message and reload its list.
  function switchFolder(mb: string) {
    setMailbox(mb);
    setSelected(null);
    setSearch("");
    loadMessages("", mb);
  }

  async function openMessage(uid: number) {
    setMsgLoading(true);
    setSelected(null);
    try {
      const res = await fetch(
        `/api/mail/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`,
        { cache: "no-store", credentials: "same-origin" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to open message");
      setSelected(json.message);
      // Reflect "read" in the list without a full refetch.
      setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Couldn't open message", description: e?.message });
    } finally {
      setMsgLoading(false);
    }
  }

  // ---- render states ----
  if (connected === null) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (!connected || showSettings) {
    return (
      <ConnectForm
        account={account}
        onCancel={connected ? () => setShowSettings(false) : undefined}
        onConnected={async () => {
          setShowSettings(false);
          const ok = await loadAccount();
          if (ok) loadMessages();
        }}
        onDisconnected={async () => {
          setShowSettings(false);
          setSelected(null);
          setMessages([]);
          await loadAccount();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Inbox"
        description={account ? `Connected: ${account.username}` : "Read and reply to email replies"}
      >
        <button
          onClick={() => loadMessages(search, mailbox)}
          disabled={listLoading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
        >
          <RefreshCcw className={`w-4 h-4 ${listLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium"
        >
          <Settings2 className="w-4 h-4" />
          Mailbox settings
        </button>
      </SectionHeader>

      {/* View tabs: full mailbox vs replies+reactions to offers/catalogues */}
      <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
        <button
          onClick={() => setView("mailbox")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
            view === "mailbox" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          <Mail className="w-4 h-4" /> Mailbox
        </button>
        <button
          onClick={() => { setView("responses"); setSelected(null); loadResponses(); }}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
            view === "responses" ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white"
          }`}
          title="Replies + reactions (opens/clicks) to your offers & catalogues"
        >
          <Reply className="w-4 h-4" /> Responses
        </button>
      </div>

      {view === "mailbox" ? (
      <>
      {/* Folder switcher + search */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        {folders.length > 0 && (
          <select
            value={mailbox}
            onChange={(e) => switchFolder(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            title="Folder"
          >
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {folderLabel(f)}
              </option>
            ))}
          </select>
        )}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadMessages(search, mailbox);
            }}
            placeholder="Search sender, subject, or text… (press Enter)"
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Two-pane: list + reader */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* List */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
          {listLoading ? (
            <div className="p-4 text-sm text-gray-400">Loading messages…</div>
          ) : listError ? (
            <div className="p-4 text-sm text-rose-300">{listError}</div>
          ) : messages.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">No messages.</div>
          ) : (
            <ul className="divide-y divide-gray-800 max-h-[70vh] overflow-y-auto">
              {messages.map((m) => {
                const active = selected?.uid === m.uid;
                return (
                  <li key={m.uid}>
                    <button
                      onClick={() => openMessage(m.uid)}
                      className={`w-full text-left px-3 py-3 hover:bg-gray-800/70 transition-colors ${
                        active ? "bg-gray-800" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {!m.seen && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                        )}
                        <span
                          className={`truncate text-sm ${
                            m.seen ? "text-gray-300" : "text-white font-semibold"
                          }`}
                        >
                          {m.fromName || m.fromAddress || "(unknown)"}
                        </span>
                        <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">
                          {fmtDate(m.date)}
                        </span>
                      </div>
                      <div
                        className={`truncate text-sm mt-0.5 ${
                          m.seen ? "text-gray-400" : "text-gray-200"
                        }`}
                      >
                        {m.subject}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Reader */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 min-h-[50vh]">
          {msgLoading ? (
            <div className="p-6 text-sm text-gray-400">Opening…</div>
          ) : !selected ? (
            <div className="p-10 text-center text-gray-500">
              <Mail className="w-10 h-10 mx-auto mb-2 opacity-40" />
              Select a message to read it.
            </div>
          ) : (
            <MessageView
              message={selected}
              mailbox={mailbox}
              fromName={account?.from_name || ""}
              onBack={() => setSelected(null)}
              onMarkUnread={(uid) => {
                // Reflect unread in the list (bold) and return to the list view.
                setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: false } : m)));
                setSelected(null);
              }}
            />
          )}
        </div>
      </div>
      </>
      ) : (
        <ResponsesPane
          loading={respLoading}
          error={respError}
          mailboxConnected={respMailboxConnected}
          responses={responses}
          onRefresh={loadResponses}
          onOpenReply={openReply}
          selected={selected}
          msgLoading={msgLoading}
          fromName={account?.from_name || ""}
          onClearSelected={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Responses (replies + reactions) ---------------- */

function ResponsesPane({
  loading,
  error,
  mailboxConnected,
  responses,
  onRefresh,
  onOpenReply,
  selected,
  msgLoading,
  fromName,
  onClearSelected,
}: {
  loading: boolean;
  error: string | null;
  mailboxConnected: boolean;
  responses: ResponseItem[];
  onRefresh: () => void;
  onOpenReply: (uid: number) => void;
  selected: MsgFull | null;
  msgLoading: boolean;
  fromName: string;
  onClearSelected: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
      <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <span className="text-xs text-gray-400">
            {responses.length} contact{responses.length === 1 ? "" : "s"} responded
          </span>
          <button onClick={onRefresh} disabled={loading} className="text-xs text-gray-400 hover:text-white">
            Refresh
          </button>
        </div>
        {!mailboxConnected && (
          <div className="px-3 py-2 text-[11px] text-amber-300/80 border-b border-gray-800">
            Mailbox not connected — showing opens/clicks only (no replies).
          </div>
        )}
        {loading ? (
          <div className="p-4 text-sm text-gray-400">Loading responses…</div>
        ) : error ? (
          <div className="p-4 text-sm text-rose-300">{error}</div>
        ) : responses.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">
            No replies or reactions yet. Once recipients open, click, or reply to your
            offers/catalogues, they’ll appear here.
          </div>
        ) : (
          <ul className="divide-y divide-gray-800 max-h-[70vh] overflow-y-auto">
            {responses.map((r) => (
              <li key={r.email}>
                <button
                  onClick={() => r.replied && r.reply && onOpenReply(r.reply.uid)}
                  disabled={!r.replied}
                  className={`w-full text-left px-3 py-3 transition-colors ${
                    r.replied ? "hover:bg-gray-800/70 cursor-pointer" : "cursor-default"
                  } ${selected && r.reply && selected.uid === r.reply.uid ? "bg-gray-800" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-white">{r.email}</span>
                    <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">{fmtDate(r.last_at)}</span>
                  </div>
                  {r.campaign?.subject && (
                    <div className="truncate text-xs text-gray-500 mt-0.5">
                      re: {r.campaign.subject}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {r.replied && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-600/20 text-emerald-300">
                        <Reply className="w-3 h-3" /> Replied
                      </span>
                    )}
                    {r.clicked && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-600/20 text-sky-300">
                        Clicked{r.clicks > 1 ? ` ×${r.clicks}` : ""}
                      </span>
                    )}
                    {r.opened && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-300">
                        Opened
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 min-h-[50vh]">
        {msgLoading ? (
          <div className="p-6 text-sm text-gray-400">Opening reply…</div>
        ) : !selected ? (
          <div className="p-10 text-center text-gray-500">
            <Reply className="w-10 h-10 mx-auto mb-2 opacity-40" />
            Select a contact who replied to read their message. Opened/clicked-only
            contacts have no message to show.
          </div>
        ) : (
          <MessageView
            message={selected}
            mailbox="INBOX"
            fromName={fromName}
            onBack={onClearSelected}
            onMarkUnread={() => onClearSelected()}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------- Message + reply ---------------- */

function MessageView({
  message,
  mailbox,
  fromName,
  onBack,
  onMarkUnread,
}: {
  message: MsgFull;
  mailbox: string;
  fromName: string;
  onBack: () => void;
  onMarkUnread: (uid: number) => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);

  async function markUnread() {
    setMarkingUnread(true);
    try {
      const res = await fetch(`/api/mail/messages/${message.uid}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ seen: false, mailbox }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to mark unread");
      toast({ title: "Marked as unread" });
      onMarkUnread(message.uid);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not mark unread", description: e?.message });
    } finally {
      setMarkingUnread(false);
    }
  }

  async function sendReply() {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/mail/messages/${message.uid}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ body: replyText, mailbox }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to send reply");
      toast({
        title: "Reply sent",
        description: `To ${message.fromAddress}${json?.savedToSent ? " · saved to Sent" : ""}`,
      });
      setReplyText("");
      setReplyOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Reply failed", description: e?.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white break-words">{message.subject}</h2>
            <div className="text-sm text-gray-400 mt-1">
              <span className="text-gray-200">{message.fromName || message.fromAddress}</span>
              {message.fromName && (
                <span className="text-gray-500"> &lt;{message.fromAddress}&gt;</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{fmtDate(message.date, true)}</div>
          </div>
          <button
            onClick={onBack}
            className="lg:hidden inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        </div>

        {message.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.attachments.map((a, i) => (
              <a
                key={i}
                href={`/api/mail/messages/${message.uid}/attachments/${i}?mailbox=${encodeURIComponent(mailbox)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 hover:border-emerald-600 hover:text-emerald-300 text-[11px] text-gray-300"
                title={`Download · ${a.contentType} · ${fmtBytes(a.size)}`}
              >
                <Paperclip className="w-3 h-3" />
                {a.filename}
              </a>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setReplyOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          >
            <Reply className="w-4 h-4" /> Reply
          </button>
          <button
            onClick={markUnread}
            disabled={markingUnread}
            title="Mark this message as unread"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-gray-200 text-sm font-medium disabled:opacity-60"
          >
            <MailMinus className="w-4 h-4" /> {markingUnread ? "Marking…" : "Mark as unread"}
          </button>
        </div>
      </div>

      {/* Body — rendered in a sandboxed iframe so the email's HTML/CSS can't
          touch the app and no remote scripts run. */}
      <div className="flex-1 bg-white">
        <iframe
          title="Message body"
          sandbox=""
          srcDoc={wrapEmailHtml(message.html || escapeHtml(message.text))}
          className="w-full"
          style={{ height: "55vh", border: 0 }}
        />
      </div>

      {replyOpen && (
        <div className="p-4 border-t border-gray-800 bg-gray-900">
          <div className="text-xs text-gray-400 mb-1">
            Replying to <b className="text-gray-200">{message.fromAddress}</b>
            {fromName ? <> as {fromName}</> : null}
          </div>
          <textarea
            rows={5}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply…"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setReplyOpen(false)}
              disabled={sending}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={sendReply}
              disabled={sending || !replyText.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Connect / settings form ---------------- */

const PRESETS: { label: string; host: string; port: number }[] = [
  // GoDaddy now resells Titan ("powered by Titan", webmail at *.titan.email).
  { label: "GoDaddy (Titan)", host: "imap.titan.email", port: 993 },
  { label: "GoDaddy (legacy)", host: "imap.secureserver.net", port: 993 },
  { label: "Gmail", host: "imap.gmail.com", port: 993 },
  { label: "Outlook / Microsoft 365", host: "outlook.office365.com", port: 993 },
  { label: "Yahoo", host: "imap.mail.yahoo.com", port: 993 },
  { label: "Zoho", host: "imap.zoho.com", port: 993 },
];

function ConnectForm({
  account,
  onConnected,
  onDisconnected,
  onCancel,
}: {
  account: Account | null;
  onConnected: () => void;
  onDisconnected: () => void;
  onCancel?: () => void;
}) {
  const [host, setHost] = useState(account?.imap_host || "");
  const [port, setPort] = useState(account?.imap_port || 993);
  const [secure, setSecure] = useState(account?.imap_secure ?? true);
  const [username, setUsername] = useState(account?.username || "");
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState(account?.from_name || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    if (!host.trim() || !username.trim()) {
      setErr("IMAP host and username are required");
      return;
    }
    if (!account && !password) {
      setErr("Password is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/mail/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          imap_host: host.trim(),
          imap_port: Number(port) || 993,
          imap_secure: secure,
          username: username.trim(),
          password, // blank on edit = keep existing
          from_name: fromName.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not connect");
      toast({ title: "Mailbox connected" });
      onConnected();
    } catch (e: any) {
      setErr(e?.message || "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect this mailbox? Your saved credentials will be removed.")) return;
    setBusy(true);
    try {
      await fetch("/api/mail/account", { method: "DELETE", credentials: "same-origin" });
      toast({ title: "Mailbox disconnected" });
      onDisconnected();
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500";
  const labelCls = "text-xs text-gray-400 block mb-1";

  return (
    <div className="space-y-4">
      <SectionHeader
        title={account ? "Mailbox settings" : "Connect your mailbox"}
        description="Connect over IMAP to read and reply to your email here."
      >
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to inbox
          </button>
        )}
      </SectionHeader>

      <div className="max-w-2xl rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        {err && (
          <div className="text-sm text-rose-300 border border-rose-700/50 bg-rose-950/40 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        {/* Presets */}
        <div>
          <div className={labelCls}>Quick setup</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setHost(p.host);
                  setPort(p.port);
                  setSecure(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-xs text-gray-200"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className={labelCls}>IMAP host</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="imap.yourprovider.com"
              className={fieldCls}
            />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className={fieldCls}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
                className="rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
              />
              Use SSL/TLS (port 993)
            </label>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Email / username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@yourcompany.com"
              className={fieldCls}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>
              Password {account && <span className="text-gray-500">(leave blank to keep current)</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={account ? "••••••••" : "App password recommended"}
              className={fieldCls}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              For Gmail / Outlook with 2-factor auth, create an <b>app password</b> and use it here.
            </p>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Reply name (optional)</label>
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Shown as the sender name on your replies"
              className={fieldCls}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {account ? (
            <button
              onClick={disconnect}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-rose-700 hover:text-rose-200 text-sm text-gray-300"
            >
              Disconnect
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={connect}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60"
          >
            <Plug className="w-4 h-4" />
            {busy ? "Connecting…" : account ? "Save & reconnect" : "Connect mailbox"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function fmtDate(iso: string | null, full = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  if (full) return d.toLocaleString();
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Friendly folder name — prefer the special-use role (Sent/Drafts/…) so the
// list reads well even when the server's folder paths are cryptic.
function folderLabel(f: { path: string; name: string; specialUse: string | null }): string {
  const special: Record<string, string> = {
    "\\Inbox": "Inbox",
    "\\Sent": "Sent",
    "\\Drafts": "Drafts",
    "\\Junk": "Spam",
    "\\Trash": "Trash",
    "\\Archive": "Archive",
  };
  if (f.path.toUpperCase() === "INBOX") return "Inbox";
  if (f.specialUse && special[f.specialUse]) return special[f.specialUse];
  return f.name || f.path;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Give the email body a sane base style inside the sandboxed iframe.
function wrapEmailHtml(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
       color:#111;margin:16px;line-height:1.5;word-break:break-word}
  img{max-width:100%;height:auto}
  a{color:#0a66c2}
  blockquote{border-left:3px solid #ddd;margin:0;padding-left:12px;color:#555}
</style></head><body>${inner || "<p style='color:#888'>(empty message)</p>"}</body></html>`;
}
