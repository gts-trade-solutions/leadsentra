"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Linkedin,
  Facebook,
  Instagram,
  Send as TelegramIcon,
  MessageCircle as WhatsAppIcon,
  BookOpen as MediumIcon,
  Lock,
  Sparkles,
  Upload,
  RefreshCcw,
  ShieldAlert,
  ImagePlus,
  Unplug,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import SectionHeader from "@/components/SectionHeader";
import WalletBadge from "@/components/WalletBadge";
import { toast } from "@/hooks/use-toast";

type Channel = "linkedin" | "facebook" | "instagram" | "telegram" | "whatsapp" | "medium";

type StatusShape = {
  connected: boolean;
  // common
  changes_left?: number | null;
  // facebook
  page_id?: string | null;
  page_name?: string | null;
  pages?: { id: string; name: string; instagram_business_account_id?: string | null }[];
  // instagram
  instagram_user_id?: string | null;
  reason?: string | null;
};

const CHANNELS: { key: Channel; label: string; icon: any; enabled: boolean }[] = [
  { key: "linkedin",  label: "LinkedIn",  icon: Linkedin,     enabled: true },
  { key: "facebook",  label: "Facebook",  icon: Facebook,     enabled: true },
  { key: "instagram", label: "Instagram", icon: Instagram,    enabled: true },
  { key: "telegram",  label: "Telegram",  icon: TelegramIcon, enabled: true },
  { key: "whatsapp",  label: "WhatsApp",  icon: WhatsAppIcon, enabled: true },
  { key: "medium",    label: "Medium",    icon: MediumIcon,   enabled: true },
];

const TONES = ["friendly", "professional", "playful", "bold", "informative"] as const;
const LENGTHS = ["short", "medium", "long"] as const;

// Per-channel API endpoint mapping.  All channels expose:
//   GET  ${base}/status   → { connected, ... }
//   POST ${base}/post     → posts the draft + image
// LinkedIn's auth lives at /api/linkedin/authorize; Facebook/Instagram share
// /api/facebook/start (a single Meta OAuth connection covers both).
const CHANNEL_API: Record<
  Channel,
  { statusUrl: string; postUrl: string; connectUrl: string }
> = {
  linkedin: {
    statusUrl: "/api/social/linkedin/status",
    postUrl: "/api/social/linkedin/post",
    connectUrl: "/api/linkedin/authorize",
  },
  facebook: {
    statusUrl: "/api/social/facebook/status",
    postUrl: "/api/social/facebook/post",
    connectUrl: "/api/facebook/start",
  },
  instagram: {
    statusUrl: "/api/social/instagram/status",
    postUrl: "/api/social/instagram/post",
    connectUrl: "/api/facebook/start", // IG piggybacks on the Meta OAuth
  },
  telegram: {
    statusUrl: "/api/social/telegram/status",
    postUrl: "/api/social/telegram/post",
    // Telegram uses a shared bot + channel configured via env vars — no
    // per-user OAuth, so there's no "connect" page to send users to.
    connectUrl: "",
  },
  whatsapp: {
    statusUrl: "/api/social/whatsapp/status",
    postUrl: "/api/social/whatsapp/post",
    // WhatsApp Cloud API is also env-var-driven (no per-user OAuth).
    connectUrl: "",
  },
  medium: {
    statusUrl: "/api/social/medium/status",
    postUrl: "/api/social/medium/post",
    // Medium uses a shared integration token (no OAuth flow).
    connectUrl: "",
  },
};

export default function MultiChannelPage() {
  const [active, setActive] = useState<Channel>("linkedin");

  const [post, setPost] = useState("");
  const [hint, setHint] = useState("Tighten the copy and make it scannable.");
  const [tone, setTone] = useState<(typeof TONES)[number]>("friendly");
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("medium");

  const [optimizing, setOptimizing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Per-channel status — keyed by channel so switching tabs doesn't refetch.
  const [statuses, setStatuses] = useState<Partial<Record<Channel, StatusShape>>>({});
  const [statusLoading, setStatusLoading] = useState(false);

  // ---- effects ----
  async function refreshStatus(channel: Channel = active) {
    const api = CHANNEL_API[channel];
    if (!api.statusUrl) return;
    setStatusLoading(true);
    try {
      const r = await fetch(api.statusUrl, { credentials: "same-origin", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setStatuses((prev) => ({ ...prev, [channel]: j }));
    } catch {
      setStatuses((prev) => ({ ...prev, [channel]: { connected: false } }));
    } finally {
      setStatusLoading(false);
    }
  }

  // Initial load: fetch every enabled channel's status in parallel.
  useEffect(() => {
    Promise.all([
      refreshStatus("linkedin"),
      refreshStatus("facebook"),
      refreshStatus("instagram"),
      refreshStatus("telegram"),
      refreshStatus("whatsapp"),
      refreshStatus("medium"),
    ]);
    // Surface the OAuth callback's redirect signals as toasts.
    const url = new URL(window.location.href);
    let touched = false;

    // ---- Facebook / Instagram (Meta OAuth) ----
    if (url.searchParams.get("fb_connected")) {
      toast({ title: "Facebook connected", description: "You can now post to Facebook + Instagram." });
      touched = true;
    }
    const fbErr = url.searchParams.get("fb_error");
    if (fbErr) {
      toast({ variant: "destructive", title: "Facebook connection failed", description: fbErr });
      touched = true;
    }

    // ---- LinkedIn ----
    if (url.searchParams.get("li_connected")) {
      toast({ title: "LinkedIn connected", description: "You can now post to LinkedIn." });
      setActive("linkedin");
      refreshStatus("linkedin");
      touched = true;
    }
    const liErr = url.searchParams.get("li_error");
    if (liErr) {
      const desc = url.searchParams.get("li_error_description") || liErr;
      toast({ variant: "destructive", title: "LinkedIn connection failed", description: desc });
      touched = true;
    }

    if (touched) window.history.replaceState({}, "", url.pathname);

    // ---- Chain resume: if a previous Connect-All set a next provider in
    // sessionStorage, and we just got a li_/fb_ callback signal, kick off
    // the next OAuth automatically.
    const chainRaw = sessionStorage.getItem("connectChain");
    if (chainRaw && touched) {
      const queue = chainRaw.split(",").filter(Boolean) as Channel[];
      const next = queue.shift();
      if (queue.length) sessionStorage.setItem("connectChain", queue.join(","));
      else sessionStorage.removeItem("connectChain");
      const nextUrl = next ? CHANNEL_API[next]?.connectUrl : null;
      if (next && nextUrl) {
        toast({
          title: `Now connecting ${labelOf(next)}…`,
          description: "Redirecting to the provider.",
        });
        setTimeout(() => {
          window.location.href = nextUrl;
        }, 1200);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-refresh whenever the user switches to a tab we haven't loaded yet.
  useEffect(() => {
    if (!statuses[active] && CHANNEL_API[active].statusUrl) refreshStatus(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- handlers ----
  function onConnect() {
    const url = CHANNEL_API[active].connectUrl;
    if (!url) {
      toast({ variant: "destructive", title: "Channel not available yet" });
      return;
    }
    window.location.href = url;
  }

  /**
   * One-click chained OAuth: kicks off the first missing connect, and uses
   * sessionStorage to remember the next provider to redirect to once the
   * first one finishes. Instagram piggybacks on Facebook's OAuth so it's
   * not part of the chain itself.
   */
  function onConnectAll() {
    const queue: Channel[] = [];
    if (!statuses.linkedin?.connected) queue.push("linkedin");
    if (!statuses.facebook?.connected) queue.push("facebook");

    if (queue.length === 0) {
      toast({ title: "All channels already connected" });
      return;
    }

    if (queue.length > 1) {
      sessionStorage.setItem("connectChain", queue.slice(1).join(","));
    } else {
      sessionStorage.removeItem("connectChain");
    }

    toast({
      title: queue.length > 1 ? `Connecting ${queue.length} channels…` : `Connecting ${labelOf(queue[0])}…`,
      description: queue.length > 1 ? "You'll be redirected through each provider." : undefined,
    });

    setTimeout(() => {
      window.location.href = CHANNEL_API[queue[0]].connectUrl;
    }, 400);
  }

  async function onDisconnectFacebook() {
    if (!confirm("Disconnect Facebook? This also stops Instagram posting.")) return;
    try {
      await fetch("/api/social/facebook/disconnect", { method: "POST", credentials: "same-origin" });
      toast({ title: "Disconnected" });
      await Promise.all([refreshStatus("facebook"), refreshStatus("instagram")]);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message || "" });
    }
  }

  async function onSelectPage(pageId: string) {
    try {
      const r = await fetch("/api/social/facebook/select-page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ page_id: pageId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to switch page");
      toast({ title: "Switched Page", description: j?.page_name });
      await Promise.all([refreshStatus("facebook"), refreshStatus("instagram")]);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message || "" });
    }
  }

  async function onOptimize() {
    if (!post.trim()) {
      toast({ variant: "destructive", title: "Write a draft first" });
      return;
    }
    setOptimizing(true);
    try {
      const r = await fetch("/api/ai/optimize-post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ post, hint, tone, length, platform: active }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 402) toast({ variant: "destructive", title: "Not enough credits" });
        else toast({ variant: "destructive", title: "Optimisation failed", description: j?.error || "" });
        return;
      }
      setPost(j.text);
      toast({ title: "Post optimised", description: `Tone: ${tone} · Length: ${length}` });
    } finally {
      setOptimizing(false);
    }
  }

  async function onGenerateImage() {
    setGeneratingImage(true);
    try {
      const r = await fetch("/api/ai/post-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ prompt: post.slice(0, 400), platform: active }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: r.status === 501 ? "Image generation coming soon" : "Generation failed",
          description: j?.error || "",
        });
        return;
      }
      if (j?.url) setImageUrl(j.url);
    } finally {
      setGeneratingImage(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-picked after an error.
    e.target.value = "";

    // Optimistic preview while the cloud upload runs.
    const localPreview = URL.createObjectURL(file);
    setImageUrl(localPreview);
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/uploads/social-image", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.url) {
        setImageUrl(null);
        URL.revokeObjectURL(localPreview);
        toast({
          variant: "destructive",
          title: "Image upload failed",
          description: j?.error || "Could not upload to storage.",
        });
        return;
      }
      // Swap the blob: preview for the real public URL the social APIs can fetch.
      setImageUrl(j.url);
      URL.revokeObjectURL(localPreview);
      toast({ title: "Image uploaded", description: "Ready to post to all channels." });
    } catch (err: any) {
      setImageUrl(null);
      URL.revokeObjectURL(localPreview);
      toast({
        variant: "destructive",
        title: "Image upload failed",
        description: err?.message || "Network error.",
      });
    } finally {
      setUploadingImage(false);
    }
  }

  // Post handler. Called with `target = "all"` to broadcast to every
  // connected channel (the big primary button), or with a specific Channel
  // to send to just that one (the per-channel "send only this" buttons).
  // The body of this function is shared between both modes — the only
  // difference is the targets list.
  async function onPostNow(target: Channel | "all" = "all") {
    if (!post.trim() && !imageUrl) {
      toast({ variant: "destructive", title: "Nothing to post" });
      return;
    }

    let targets: Channel[];
    if (target === "all") {
      targets = (Object.keys(CHANNEL_API) as Channel[]).filter((c) => {
        if (!CHANNEL_API[c].postUrl) return false;
        if (!statuses[c]?.connected) return false;
        if (c === "instagram" && !imageUrl) return false;
        return true;
      });
    } else {
      // Single-channel mode — validate the one chosen channel is usable.
      if (!CHANNEL_API[target].postUrl) {
        toast({ variant: "destructive", title: `${labelOf(target)} isn't wired up yet` });
        return;
      }
      if (!statuses[target]?.connected) {
        toast({ variant: "destructive", title: `Connect ${labelOf(target)} first` });
        return;
      }
      if (target === "instagram" && !imageUrl) {
        toast({
          variant: "destructive",
          title: "Instagram needs an image",
          description: "Attach an image before posting to Instagram.",
        });
        return;
      }
      targets = [target];
    }

    if (targets.length === 0) {
      toast({
        variant: "destructive",
        title: "No connected channels",
        description: "Connect LinkedIn, Facebook, or Instagram first.",
      });
      return;
    }

    // Broadcast-mode-only courtesy notice when IG was connected but skipped
    // for lack of image. Single-channel IG sends already errored above.
    if (target === "all" && statuses.instagram?.connected && !imageUrl) {
      toast({
        title: "Instagram skipped",
        description: "Instagram needs an image — attach one to include it.",
      });
    }

    setPosting(true);
    try {
      const results = await Promise.allSettled(
        targets.map(async (c) => {
          const r = await fetch(CHANNEL_API[c].postUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ text: post, image_url: imageUrl }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error || `Post failed (${r.status})`);
          return c;
        }),
      );

      const ok: Channel[] = [];
      const failed: { channel: Channel; error: string }[] = [];
      results.forEach((res, i) => {
        const c = targets[i];
        if (res.status === "fulfilled") ok.push(c);
        else failed.push({ channel: c, error: (res.reason as Error)?.message || "Unknown error" });
      });

      if (ok.length) {
        toast({
          title: `Posted to ${ok.map(labelOf).join(", ")}`,
          description: failed.length ? `${failed.length} channel(s) failed — see below.` : undefined,
        });
      }
      failed.forEach((f) =>
        toast({
          variant: "destructive",
          title: `${labelOf(f.channel)} failed`,
          description: f.error,
        }),
      );
    } finally {
      setPosting(false);
    }
  }

  const channelLabel = useMemo(() => labelOf(active), [active]);
  const activeStatus = statuses[active];
  const fbStatus = statuses.facebook;

  // How many of the chain-eligible providers still need OAuth (IG piggybacks on FB).
  const missingConnectCount = useMemo(
    () =>
      (["linkedin", "facebook"] as Channel[]).filter((c) => !statuses[c]?.connected).length,
    [statuses],
  );

  // Channels the next click would broadcast to (mirrors onPostNow's filter).
  const broadcastTargets = useMemo<Channel[]>(
    () =>
      (Object.keys(CHANNEL_API) as Channel[]).filter((c) => {
        if (!CHANNEL_API[c].postUrl) return false;
        if (!statuses[c]?.connected) return false;
        if (c === "instagram" && !imageUrl) return false;
        return true;
      }),
    [statuses, imageUrl],
  );

  const someDisabledExist = CHANNELS.some((c) => !c.enabled);

  return (
    <AuthGuard>
      <div className="space-y-6">
        <SectionHeader
          title="Multi-Channel Campaigns"
          description="Write once, optimise with AI, and publish across your social channels."
        >
          <WalletBadge />
        </SectionHeader>

        {someDisabledExist && (
          <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 text-amber-200 p-3 text-sm flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              WhatsApp is still locked.{" "}
              <a href="mailto:info@raceinnovations.in" className="underline">Contact us</a> to enable them.
            </span>
          </div>
        )}

        {/* Tab strip */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-gray-800">
          <nav className="flex flex-wrap" role="tablist" aria-label="Channels">
            {CHANNELS.map(({ key, label, icon: Icon, enabled }) => {
              const isActive = active === key;
              const isConnected = !!statuses[key]?.connected;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={isActive}
                  disabled={!enabled}
                  onClick={() => enabled && setActive(key)}
                  className={`relative px-4 py-3 text-sm font-medium flex items-center gap-2 transition-colors
                    ${enabled ? "text-gray-300 hover:text-white" : "text-gray-600 cursor-not-allowed"}
                    ${isActive ? "text-emerald-400" : ""}`}
                  title={enabled ? `Switch to ${label}` : `${label} (locked)`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  {!enabled && <Lock className="w-3 h-3 opacity-70" />}
                  {enabled && isConnected && (
                    <span
                      className="w-2 h-2 rounded-full bg-emerald-400"
                      title="Connected"
                    />
                  )}
                  {isActive && (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 bg-emerald-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 pb-2 md:pb-0">
            <span className="text-xs text-gray-400">
              {activeStatus?.connected ? (
                <>
                  Connected
                  {activeStatus.page_name && (
                    <> · <b className="text-white">{activeStatus.page_name}</b></>
                  )}
                </>
              ) : (
                "Not connected"
              )}
            </span>
            {missingConnectCount > 0 && (
              <button
                onClick={onConnectAll}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                title="Connect every channel you haven't authorised yet, one after another"
              >
                <Sparkles className="w-4 h-4" />
                Connect all ({missingConnectCount})
              </button>
            )}
            <button
              onClick={() => refreshStatus(active)}
              disabled={statusLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm disabled:opacity-50"
            >
              <RefreshCcw className={`w-4 h-4 ${statusLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Facebook Page picker — shows under FB and IG tabs when multiple pages exist */}
        {(active === "facebook" || active === "instagram") &&
          fbStatus?.connected &&
          fbStatus.pages &&
          fbStatus.pages.length > 1 && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-xs text-gray-400">Posting from Page:</span>
              <select
                value={fbStatus.page_id ?? ""}
                onChange={(e) => onSelectPage(e.target.value)}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-200"
              >
                {fbStatus.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.instagram_business_account_id ? "  (IG linked)" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={onDisconnectFacebook}
                className="ml-auto inline-flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200"
              >
                <Unplug className="w-3.5 h-3.5" /> Disconnect
              </button>
            </div>
          )}

        {/* Per-channel "why is this disconnected" notice. Surfaces the
            reason string returned by each channel's status endpoint
            (Instagram, Telegram, WhatsApp, Medium). */}
        {(active === "instagram" ||
          active === "telegram" ||
          active === "whatsapp" ||
          active === "medium") &&
          !statuses[active]?.connected &&
          statuses[active]?.reason && (
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 text-amber-200 p-3 text-sm">
            {statuses[active]!.reason}
          </div>
        )}

        {/* Editor + image grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="mc-post" className="block text-sm font-medium text-gray-300 mb-2">
                Your {channelLabel} Post
              </label>
              <textarea
                id="mc-post"
                rows={10}
                value={post}
                onChange={(e) => setPost(e.target.value)}
                placeholder={
                  active === "instagram"
                    ? "Type your caption… (Instagram requires an image)"
                    : "Type or paste your post here…"
                }
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-xl text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>

            <div>
              <label htmlFor="mc-hint" className="block text-sm text-gray-400 mb-1">
                Optimization hint <span className="text-gray-500">(1 credit · free for staff)</span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                <input
                  id="mc-hint"
                  type="text"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <select
                  aria-label="Tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value as any)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200"
                >
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  aria-label="Length"
                  value={length}
                  onChange={(e) => setLength(e.target.value as any)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200"
                >
                  {LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="mt-3">
                <button
                  onClick={onOptimize}
                  disabled={optimizing}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4" />
                  {optimizing ? "Optimising…" : "Optimize with AI"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <div className="text-sm font-medium text-white mb-1">Draft Preview</div>
                <div className="text-sm text-gray-400 whitespace-pre-wrap min-h-[80px]">
                  {post.trim() ? post : "Your content will appear here…"}
                </div>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-sm text-gray-300">
                    {broadcastTargets.length > 0 ? (
                      <>
                        Will post to{" "}
                        <span className="text-white font-medium">
                          {broadcastTargets.map(labelOf).join(", ")}
                        </span>
                        .
                      </>
                    ) : activeStatus?.connected ? (
                      "Review and post."
                    ) : (
                      `Connect ${channelLabel} to start broadcasting.`
                    )}
                  </div>
                  {broadcastTargets.length > 1 ? (
                    <button
                      onClick={() => onPostNow("all")}
                      disabled={posting || uploadingImage}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60"
                      title="Post to every connected channel in one click"
                    >
                      <Sparkles className="w-4 h-4" />
                      {uploadingImage
                        ? "Uploading image…"
                        : posting
                        ? `Posting to ${broadcastTargets.length}…`
                        : `Post to all ${broadcastTargets.length} channels`}
                    </button>
                  ) : broadcastTargets.length === 0 ? (
                    <button
                      onClick={onConnect}
                      disabled={!CHANNEL_API[active].connectUrl}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60"
                    >
                      <ChannelIcon channel={active} className="w-4 h-4" />
                      Connect {channelLabel}
                    </button>
                  ) : null}
                </div>

                {/* Per-channel send buttons — lets the user post to one
                    channel only, without firing the group broadcast. The
                    "Post to all" button above remains the primary CTA when
                    more than one channel is connected. */}
                {broadcastTargets.length > 0 && (
                  <div className="pt-2 border-t border-gray-800">
                    <div className="text-xs text-gray-500 mb-2">
                      {broadcastTargets.length > 1
                        ? "Or send to just one channel:"
                        : "Send to:"}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {broadcastTargets.map((c) => (
                        <button
                          key={c}
                          onClick={() => onPostNow(c)}
                          disabled={posting || uploadingImage}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50"
                          title={`Send to ${labelOf(c)} only`}
                        >
                          <ChannelIcon channel={c} className="w-3.5 h-3.5" />
                          Post to {labelOf(c)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Secondary connect prompt when the active tab's channel
                    isn't connected yet but other channels are. */}
                {broadcastTargets.length > 0 &&
                  !activeStatus?.connected &&
                  CHANNEL_API[active].connectUrl && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-800 text-xs">
                      <span className="text-gray-400">
                        {channelLabel} is not connected — it won't receive this post.
                      </span>
                      <button
                        onClick={onConnect}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30"
                      >
                        <ChannelIcon channel={active} className="w-3.5 h-3.5" />
                        Connect {channelLabel}
                      </button>
                    </div>
                  )}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold">Post Image</h3>
                <span className="text-xs text-emerald-300 border border-emerald-700/50 bg-emerald-900/20 rounded-full px-2 py-0.5">
                  {generatingImage ? "…" : "5 credits"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingImage}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-600/60 text-emerald-300 hover:bg-emerald-900/30 text-sm disabled:opacity-60"
                >
                  <Upload className="w-4 h-4" />
                  {uploadingImage ? "Uploading…" : "Upload"}
                </button>
                <button
                  onClick={onGenerateImage}
                  disabled={generatingImage}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4" />
                  {generatingImage ? "Generating…" : "Generate with AI"}
                </button>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
                aria-label="Upload post image"
              />
            </div>

            {imageUrl ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Post preview" className="w-full h-auto" />
                <button
                  onClick={() => setImageUrl(null)}
                  className="block w-full text-xs text-gray-400 hover:text-white p-2 border-t border-gray-800"
                >
                  Remove image
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800 text-gray-300 py-6 flex flex-col items-center gap-1 transition-colors"
              >
                <ImagePlus className="w-5 h-5" />
                <span className="text-sm">Choose image…</span>
                <span className="text-xs text-gray-500">Recommended: 1792×1024 (landscape)</span>
              </button>
            )}
          </aside>
        </div>
      </div>
    </AuthGuard>
  );
}

function labelOf(c: Channel) {
  return CHANNELS.find((x) => x.key === c)?.label ?? c;
}
function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = CHANNELS.find((c) => c.key === channel)?.icon ?? Linkedin;
  return <Icon className={className} />;
}
