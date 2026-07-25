/**
 * Describe a failed bulk-upload response in terms of the layer that rejected it.
 *
 * A reverse proxy (nginx) answers with an HTML error page, not JSON, so callers
 * that did `await res.json()` threw and reported a bare "Upload failed" for
 * every cause alike — a 413 from the proxy, a 504 timeout and a genuine
 * application error were indistinguishable in the UI.
 */
export function describeUploadFailure(status: number, body: string, fileSize?: number): string {
  const mb = fileSize ? ` (this file is ${(fileSize / 1024 / 1024).toFixed(1)} MB)` : "";

  if (status === 413) {
    return `Rejected as too large before it reached the app${mb} — the web server's upload limit (nginx client_max_body_size) is lower than the file.`;
  }
  if (status === 502 || status === 504) {
    return "The import took longer than the web server allows and the connection was cut (nginx proxy_read_timeout). Some rows may still have been saved — reload before retrying.";
  }
  if (status === 401) return "Your session expired — sign in again and retry.";
  if (status === 403) return "Bulk import is staff-only.";

  // Fall back to whatever the server said, with any HTML markup stripped.
  const text = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return `HTTP ${status}${text ? ` — ${text}` : ""}`;
}

/**
 * Read a bulk-upload response once, tolerating a non-JSON body.
 * Returns the parsed payload when there is one, plus a ready-made message for
 * the failure case.
 */
export async function readUploadResponse(
  res: Response,
  fileSize?: number
): Promise<{ ok: boolean; json: any; message: string }> {
  const raw = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* proxy error page — not JSON */
  }
  if (res.ok && json) return { ok: true, json, message: "" };
  return {
    ok: false,
    json,
    message: json?.error || describeUploadFailure(res.status, raw, fileSize),
  };
}
