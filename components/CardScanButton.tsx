"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, Sparkles, X, RotateCcw, Check } from "lucide-react";

export type ScanExtracted = {
  contact?: {
    contact_name?: string | null;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    linkedin_url?: string | null;
  };
  company?: {
    name?: string | null;
    website?: string | null;
    country?: string | null;
    city_regency?: string | null;
    industry?: string | null;
  };
};

/**
 * Drop-in "Scan business card" widget.  Renders a small banner inside a form
 * with two buttons (Take photo / From gallery) that POST the chosen image to
 * /api/ai/scan-card and pipe the extracted fields to `onExtract` so the parent
 * can pre-fill its own form.
 *
 * Staff-only: the server returns 403 for regular users.  This component does
 * not gate visibility itself — wrap it in `{isStaff && <CardScanButton ... />}`.
 */
export function CardScanButton({
  onExtract,
  label = "Have a business card? Scan it to auto-fill.",
}: {
  onExtract: (data: ScanExtracted) => void;
  label?: string;
}) {
  // Mobile camera input (capture="environment" opens the rear camera directly).
  const mobileCameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Desktop camera modal state (uses getUserMedia for a live preview).
  const [cameraOpen, setCameraOpen] = useState(false);

  // Feature-detect mobile so we can route "Take photo" to the right path:
  //  - mobile (any touch device with capture support) -> native file picker w/ capture
  //  - desktop -> getUserMedia modal with live preview
  const isMobile =
    typeof window !== "undefined" &&
    (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.userAgent)));

  function onTakePhotoClick() {
    if (isMobile) {
      mobileCameraRef.current?.click();
    } else {
      setCameraOpen(true);
    }
  }

  async function handleFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const fd = new FormData();
      fd.append("image", f);
      const res = await fetch("/api/ai/scan-card", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Scan failed");

      onExtract({ contact: json?.contact ?? {}, company: json?.company ?? {} });

      const filled = countNonNull(json?.contact) + countNonNull(json?.company);
      setSuccess(
        filled > 0
          ? `Filled ${filled} field${filled === 1 ? "" : "s"} from the card`
          : "No fields detected — try a clearer photo"
      );
    } catch (e: any) {
      setError(e?.message || "Scan failed");
    } finally {
      setBusy(false);
      // Reset the inputs so picking the same file twice still triggers onChange.
      if (mobileCameraRef.current) mobileCameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-emerald-700/60 bg-emerald-950/20 p-3 mb-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-emerald-100">
          <Sparkles className="w-4 h-4 text-emerald-300" />
          <span>{label}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onTakePhotoClick}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-60"
            title={isMobile ? "Open camera" : "Open webcam"}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium disabled:opacity-60"
            title="Choose an image from your gallery"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            From gallery
          </button>
        </div>
      </div>

      {busy && (
        <div className="mt-2 text-xs text-emerald-200">
          Extracting card details… (a few seconds)
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
      {success && !busy && (
        <div className="mt-2 text-xs text-emerald-200">{success}</div>
      )}

      {/* Mobile: capture="environment" opens the rear camera directly. */}
      <input
        ref={mobileCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {cameraOpen && (
        <WebcamCaptureModal
          onCapture={(file) => {
            setCameraOpen(false);
            handleFile(file);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Desktop webcam-capture modal.  Uses navigator.mediaDevices.getUserMedia()
 * to show a live preview, snap a still frame to a canvas, convert to a File,
 * and hand it to the parent.  Stops the stream cleanly on close.
 */
function WebcamCaptureModal({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null); // data URL preview after snap

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // facingMode: 'environment' is honored on phones; ignored on desktops.
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access in the browser address bar and try again."
            : e?.name === "NotFoundError"
            ? "No camera found on this device."
            : e?.message || "Could not open the camera."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
  }

  function retake() {
    setSnapshot(null);
  }

  async function use() {
    if (!snapshot) return;
    const res = await fetch(snapshot);
    const blob = await res.blob();
    const file = new File([blob], `card-${Date.now()}.jpg`, { type: "image/jpeg" });
    onCapture(file);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 grid place-items-center p-4">
      <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400" />
            {snapshot ? "Review photo" : "Position the business card in frame"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <div className="rounded-md border border-red-700/60 bg-red-950/40 p-4 text-sm text-red-200">
              {error}
            </div>
          ) : snapshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={snapshot} alt="captured card" className="w-full rounded-md bg-black" />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-md bg-black aspect-video"
            />
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-gray-200 text-sm hover:border-gray-600"
          >
            Cancel
          </button>
          {!error && !snapshot && (
            <button
              type="button"
              onClick={snap}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              <Camera className="w-4 h-4" /> Snap
            </button>
          )}
          {snapshot && (
            <>
              <button
                type="button"
                onClick={retake}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium"
              >
                <RotateCcw className="w-4 h-4" /> Retake
              </button>
              <button
                type="button"
                onClick={use}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              >
                <Check className="w-4 h-4" /> Use this
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function countNonNull(obj: any): number {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter((v) => v !== null && v !== "" && v !== undefined).length;
}
