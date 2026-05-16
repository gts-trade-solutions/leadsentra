'use client';

import React, { useEffect, useRef, useState } from "react";
import {
  Loader2, RefreshCcw, LogOut, Send, Upload as UploadIcon, Smartphone
} from "lucide-react";

type Props = {
  callFn: (name: string, init?: RequestInit) => Promise<any>;
};

type PhoneNumber = { id: string; display_phone_number: string };

export default function WhatsAppPanel({ callFn }: Props) {
  const [waConnected, setWaConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const [messageBody, setMessageBody] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [recipients, setRecipients] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // ---- Status ----
  async function refreshWhatsApp() {
    setError(""); setNotice("");
    try {
      const data = await callFn("whatsapp-creds", { method: "GET" });
      setWaConnected(!!data.connected);
      setPhoneNumbers(data.phone_numbers ?? []);
      setSelectedPhone(data.selected_phone ?? null);
    } catch (e: any) {
      setError(`WhatsApp status error: ${e.message || e}`);
    }
  }

  useEffect(() => { refreshWhatsApp().catch(() => {}); }, []);

  async function connectWhatsApp() {
    setConnecting(true); setError(""); setNotice("");
    try {
      const data = await callFn("whatsapp-oauth-start", { method: "GET" });
      window.open(data.url, "wa_oauth", "width=600,height=700");
      setNotice("Complete login in popup...");
    } catch (e: any) {
      setError(`Connect failed: ${e.message || e}`);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWhatsApp() {
    try {
      await callFn("whatsapp-disconnect", { method: "POST" });
      setWaConnected(false);
      setPhoneNumbers([]);
      setSelectedPhone(null);
      setNotice("Disconnected.");
    } catch (e: any) {
      setError(`Disconnect failed: ${e.message || e}`);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setUploadFile(f);
    setUploadPreview(f ? URL.createObjectURL(f) : "");
  }

  // ---- UI ----
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid lg:grid-cols-3 gap-6">
      {/* Header */}
      <div className="lg:col-span-3 flex items-center justify-between border-b border-gray-800 pb-2 mb-4">
        {waConnected ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-1 rounded border border-emerald-500 text-emerald-400">
              WhatsApp Connected
            </span>
            <select
              className="text-xs bg-transparent border border-gray-700 rounded px-2 py-1"
              value={selectedPhone ?? ""}
              onChange={(e) => setSelectedPhone(e.target.value)}
            >
              <option value="" disabled>Select Number…</option>
              {phoneNumbers.map((p) => (
                <option key={p.id} value={p.id}>{p.display_phone_number}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={refreshWhatsApp}
              className="text-xs px-2 py-1 rounded border border-gray-700 hover:border-gray-500 inline-flex items-center gap-1"
            >
              <RefreshCcw className="w-3 h-3" /> Refresh
            </button>
            <button
              type="button"
              onClick={disconnectWhatsApp}
              className="text-xs px-2 py-1 rounded border border-gray-700 hover:border-gray-500 inline-flex items-center gap-1"
            >
              <LogOut className="w-3 h-3" /> Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={connectWhatsApp}
              disabled={connecting}
              className="text-xs px-2 py-1 rounded border border-gray-700 hover:border-gray-500 inline-flex items-center gap-2 disabled:opacity-60"
            >
              {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {connecting ? "Connecting…" : "Connect WhatsApp"}
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="space-y-4 lg:col-span-2">
        <label className="text-sm text-gray-300">Message Body</label>
        <textarea
          className="w-full bg-transparent border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          rows={8}
          value={messageBody}
          onChange={(e) => setMessageBody(e.target.value)}
          placeholder="Type your WhatsApp message…"
        />

        <div className="space-y-2">
          <label className="text-xs text-gray-400">Recipients (comma-separated)</label>
          <textarea
            className="w-full bg-transparent border border-gray-700 rounded-lg p-2 text-sm"
            rows={3}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="+919876543210, +14155552671"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400">Attachment (optional)</label>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onPick} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md text-sm"
          >
            <UploadIcon className="w-4 h-4" /> Choose file
          </button>
          {uploadPreview && <img src={uploadPreview} alt="preview" className="rounded-lg border border-gray-700" />}
        </div>
      </div>

      {/* Preview & Send */}
      <div className="space-y-6">
        <div className="border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="text-sm text-gray-300">Message Preview</div>
          <div className="flex items-center gap-2 text-sm text-gray-200">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            {messageBody || "Your message will appear here…"}
          </div>
          {uploadPreview && <img src={uploadPreview} alt="preview" className="rounded-lg border border-gray-700" />}
        </div>

        <div className="border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-300">Final</div>
          </div>
          <div className="text-xs text-gray-500">Review and send.</div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!waConnected || !messageBody.trim() || !recipients.trim()}
              className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm disabled:opacity-60"
            >
              <Send className="w-4 h-4" /> Send Campaign
            </button>
          </div>
        </div>
      </div>

      {(error || notice) && (
        <div className="lg:col-span-3">
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
          {notice && <p className="text-sm text-emerald-400">{notice}</p>}
        </div>
      )}
    </form>
  );
}
