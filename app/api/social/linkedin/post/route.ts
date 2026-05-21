import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import AWS from "aws-sdk";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";
const REGISTER_UPLOAD_URL =
  "https://api.linkedin.com/v2/assets?action=registerUpload";
const PRICE_PER_POST = 1;

/**
 * POST /api/social/linkedin/post
 * Body: { text: string, image_url?: string }
 *
 * Publishes a UGC post on the connected member's feed. If image_url is
 * provided (public https), the image is registered + uploaded as a
 * LinkedIn asset and attached to the post.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  const imageUrl = body?.image_url ? String(body.image_url) : null;
  if (!text && !imageUrl) {
    return NextResponse.json({ error: "Empty post" }, { status: 400 });
  }
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
    return NextResponse.json(
      { error: "image_url must be a public https URL" },
      { status: 400 }
    );
  }

  const [rows] = await db.execute(
    `SELECT access_token, expires_at, member_urn
       FROM social_accounts
      WHERE user_id = ? AND provider = 'linkedin'
      LIMIT 1`,
    [session.id]
  );
  const acc = (rows as any[])[0];
  if (!acc?.access_token || !acc?.member_urn) {
    return NextResponse.json(
      { error: "Connect LinkedIn first" },
      { status: 400 }
    );
  }
  if (acc.expires_at && new Date(acc.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "LinkedIn session expired — reconnect" },
      { status: 401 }
    );
  }

  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_POST,
        "debit",
        `li_post:${Date.now()}`,
        "Post to LinkedIn",
      ]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("insufficient_credits")) {
        return NextResponse.json(
          { error: "Insufficient credits", code: "insufficient_credits" },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  let assetUrn: string | null = null;
  if (imageUrl) {
    try {
      assetUrn = await uploadImageAsset(acc.access_token, acc.member_urn, imageUrl);
    } catch (e: any) {
      return NextResponse.json(
        { error: `Image upload to LinkedIn failed: ${e?.message || e}` },
        { status: 502 }
      );
    }
  }

  const shareContent: any = {
    shareCommentary: { text },
    shareMediaCategory: assetUrn ? "IMAGE" : "NONE",
  };
  if (assetUrn) {
    shareContent.media = [
      {
        status: "READY",
        media: assetUrn,
      },
    ];
  }

  const payload = {
    author: acc.member_urn,
    lifecycleState: "PUBLISHED",
    specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const resp = await fetch(UGC_POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${acc.access_token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(payload),
  });
  const respText = await resp.text();
  let respJson: any = null;
  try { respJson = JSON.parse(respText); } catch { /* leave null */ }

  // Log the raw LinkedIn response so we can diagnose silent suppressions —
  // LinkedIn sometimes returns 200/201 OK while filtering the post out of
  // feeds (their spam/duplicate classifier). Looking at the headers and
  // body in server logs is the only way to tell.
  console.log(
    `[linkedin/post] status=${resp.status} ` +
    `x-restli-id="${resp.headers.get("x-restli-id") ?? ""}" ` +
    `body=${respText.slice(0, 500)}`
  );

  if (!resp.ok) {
    return NextResponse.json(
      { error: friendlyLinkedInError(resp.status, respJson, respText) },
      { status: resp.status === 429 ? 429 : 502 }
    );
  }

  const liUrn =
    resp.headers.get("x-restli-id") ||
    respJson?.id ||
    null;

  // Treat a 200/201 with no URN as a silent suppression — LinkedIn's API
  // sometimes accepts the request without actually creating a feed post
  // (duplicate detection on the soft path, or spam classifier). Better to
  // tell the user up front than show a misleading green toast.
  if (!liUrn) {
    return NextResponse.json(
      {
        error:
          "LinkedIn accepted the request but didn't return a post id — usually means the post was silently filtered (duplicate / spam classifier). Try editing the text and resending.",
      },
      { status: 502 }
    );
  }

  try {
    await db.execute(
      `INSERT INTO linkedin_posts (id, user_id, member_urn, li_post_urn, body, media_urls, status)
       VALUES (?, ?, ?, ?, ?, ?, 'posted')`,
      [
        randomUUID(),
        session.id,
        acc.member_urn,
        liUrn,
        text,
        imageUrl ? JSON.stringify([imageUrl]) : null,
      ]
    );
  } catch {
    // Logging failure shouldn't break a successful publish.
  }

  // Build a direct view URL the caller can show / click to confirm the
  // post exists on LinkedIn. Shape:
  //   urn:li:share:7234567890   → /feed/update/urn:li:share:7234567890/
  //   urn:li:ugcPost:7234...    → /feed/update/urn:li:ugcPost:7234.../
  const viewUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(liUrn)}/`;

  return NextResponse.json({ ok: true, id: liUrn, url: viewUrl });
}

/**
 * Translates LinkedIn's raw error responses into messages the user can
 * actually act on. Falls back to the original message if nothing matches.
 */
function friendlyLinkedInError(
  status: number,
  json: any,
  text: string,
): string {
  const raw = String(json?.message || text || "").toLowerCase();

  if (raw.includes("duplicate") || raw.includes("content is a duplicate")) {
    return "LinkedIn rejected this as a duplicate of a recent post. Tweak the wording slightly (a few words is enough) and try again.";
  }
  if (status === 401 || raw.includes("invalid_token") || raw.includes("token") && raw.includes("expired")) {
    return "LinkedIn session expired. Disconnect and reconnect LinkedIn to refresh the token.";
  }
  if (status === 403 || raw.includes("not enough permissions") || raw.includes("does not have permission")) {
    return "LinkedIn token is missing the w_member_social scope. Reconnect LinkedIn — the app's Products tab must include 'Share on LinkedIn'.";
  }
  if (status === 422 && raw.includes("unprocessable")) {
    return "LinkedIn couldn't process the post — usually means the text or image is malformed. Try a shorter text or a different image.";
  }
  if (status === 429) {
    return "LinkedIn rate limit hit. Wait a minute before posting again.";
  }
  // Fall back to whatever LinkedIn gave us — keep it useful, not a Java trace.
  return json?.message || text || `LinkedIn post failed (${status})`;
}

/**
 * LinkedIn's 3-step image flow:
 *   1) POST /v2/assets?action=registerUpload  → returns uploadUrl + asset URN
 *   2) PUT  uploadUrl with the raw image bytes
 *   3) Reference the asset URN under shareContent.media[].media
 *
 * We fetch the bytes from the public S3 URL since the social image
 * upload endpoint stores everything there first.
 */
async function uploadImageAsset(
  accessToken: string,
  ownerUrn: string,
  publicImageUrl: string,
): Promise<string> {
  const regBody = {
    registerUploadRequest: {
      owner: ownerUrn,
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      serviceRelationships: [
        {
          identifier: "urn:li:userGeneratedContent",
          relationshipType: "OWNER",
        },
      ],
      supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
    },
  };

  const reg = await fetch(REGISTER_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(regBody),
  });
  const regText = await reg.text();
  if (!reg.ok) throw new Error(`registerUpload ${reg.status}: ${regText}`);
  const regJson = JSON.parse(regText);

  const uploadUrl: string | undefined =
    regJson?.value?.uploadMechanism?.[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ]?.uploadUrl;
  const asset: string | undefined = regJson?.value?.asset;
  if (!uploadUrl || !asset) {
    throw new Error("registerUpload response missing uploadUrl or asset");
  }

  // Pull the bytes. If the URL points to our own S3 bucket we skip the
  // public read and go server-to-server with the AWS SDK — this lets
  // LinkedIn work even when the bucket policy hasn't been opened up yet
  // for Facebook/Instagram.
  const { buf, contentType } = await loadImageBytes(publicImageUrl);

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
    },
    body: buf,
  });
  if (!put.ok) {
    const t = await put.text().catch(() => "");
    throw new Error(`upload ${put.status}: ${t}`);
  }

  return asset;
}

/**
 * Resolves an image URL into raw bytes + content-type.
 * Uses S3 getObject if the URL is in our own bucket (no public read needed);
 * otherwise falls back to a regular HTTPS fetch.
 */
async function loadImageBytes(
  url: string,
): Promise<{ buf: Buffer; contentType: string }> {
  const region = process.env.AWS_REGION || "ap-south-1";
  const bucket = process.env.AWS_S3_BUCKET_NAME || "";

  if (bucket) {
    const ownHostPatterns = [
      `${bucket}.s3.${region}.amazonaws.com`,
      `${bucket}.s3.amazonaws.com`,
      `s3.${region}.amazonaws.com/${bucket}`,
    ];
    const u = new URL(url);
    const matched = ownHostPatterns.some(
      (p) => (u.host + u.pathname).startsWith(p),
    );
    if (matched) {
      const key = decodeURIComponent(
        u.pathname.replace(new RegExp(`^/(?:${bucket}/)?`), ""),
      );
      const s3 = new AWS.S3({
        region,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
      const obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
      return {
        buf: obj.Body as Buffer,
        contentType: obj.ContentType || "image/jpeg",
      };
    }
  }

  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  return {
    buf: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get("content-type") || "image/jpeg",
  };
}
