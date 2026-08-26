/**
 * Client-side reading of a delete response.
 *
 * A delete an admin isn't allowed to do outright comes back 202 with
 * `{ pending: true }` — the request was accepted, the thing is still there.
 * 202 is a success status, so a caller that only checks `res.ok` would announce
 * "Deleted" and drop the row from the list while it still exists. Every delete
 * goes through here so that can't happen by omission.
 *
 * Throws on a real failure, so the existing try/catch keeps working unchanged.
 */
export async function readDeleteResponse(
  res: Response
): Promise<{ pending: boolean; message: string }> {
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Delete failed");
  return {
    pending: !!json?.pending,
    message:
      json?.message ||
      "Sent to a super admin for approval. It will be deleted once they approve.",
  };
}

/** The toast for a parked delete — same wording everywhere it can happen. */
export function pendingToast(message: string) {
  return {
    title: "Sent for approval",
    description: message,
  };
}
