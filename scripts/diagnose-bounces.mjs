#!/usr/bin/env node
//
// One-shot report on the bounce feedback loop: what is configured, what SES
// knows, and what the app has actually recorded.
//
// Run this on the server when bounce notices keep arriving in the sender's
// inbox. It answers, in order:
//
//   1. Is SES routing events to the app at all, or emailing them to the sender?
//   2. Does the SNS topic have a CONFIRMED subscription to the webhook, and
//      does that URL answer when called?
//   3. Has the app ever recorded a bounce?
//   4. How many addresses is SES already refusing that are still mailable here?
//   5. What is actually bouncing, and why?
//
// Read-only. Changes nothing.
//
// Usage: node scripts/diagnose-bounces.mjs [days]      (default: 14)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import AWS from "aws-sdk";
import {
  SESv2Client,
  GetConfigurationSetEventDestinationsCommand,
  ListSuppressedDestinationsCommand,
  GetAccountCommand,
} from "@aws-sdk/client-sesv2";

for (const envFile of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(process.cwd(), envFile), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
}

const DAYS = Number(process.argv[2] || 14);
const h = (t) => console.log(`\n${"=".repeat(66)}\n${t}\n${"=".repeat(66)}`);
const ok = (s) => console.log(`  [ OK ]   ${s}`);
const bad = (s) => console.log(`  [FAIL]   ${s}`);
const warn = (s) => console.log(`  [WARN]   ${s}`);
const info = (s) => console.log(`           ${s}`);

// ---------------------------------------------------------------- 1. config
h("1. Is SES configured to tell this app about bounces?");

const region = process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";
const hasCreds = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const configSet = process.env.SES_CONFIG_SET || null;
const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || null;
const expectedArn = process.env.SNS_TOPIC_ARN || null;
const webhookUrl = appUrl ? `${appUrl.replace(/\/+$/, "")}/api/email/webhooks/ses` : null;

info(`region          ${region}`);
info(`app url         ${appUrl || "(not set)"}`);
info(`SNS_TOPIC_ARN   ${expectedArn || "(not set — the webhook accepts any topic)"}`);
hasCreds ? ok("AWS credentials present") : bad("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing");

const creds = hasCreds
  ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
  : null;
const ses = hasCreds ? new SESv2Client({ region, credentials: creds }) : null;

let publishesBounces = false;
let topicArns = [];

if (!configSet) {
  bad("SES_CONFIG_SET is not set.");
  info("This is why bounce notices arrive in the sender's mailbox: with no");
  info("configuration set, SES uses email feedback forwarding and never calls");
  info(`${webhookUrl || "<APP_URL>/api/email/webhooks/ses"}.`);
} else if (!ses) {
  warn(`SES_CONFIG_SET = ${configSet} (cannot verify without AWS credentials)`);
} else {
  try {
    const res = await ses.send(
      new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: configSet })
    );
    const enabled = (res.EventDestinations ?? []).filter((d) => d?.Enabled);
    const types = [...new Set(enabled.flatMap((d) => d.MatchingEventTypes ?? []))];
    if (!enabled.length) {
      bad(`Configuration set "${configSet}" exists but has NO enabled event destination.`);
    } else if (!types.includes("BOUNCE") || !types.includes("COMPLAINT")) {
      bad(`Configuration set "${configSet}" publishes ${types.join(", ")} — missing BOUNCE and/or COMPLAINT.`);
    } else {
      publishesBounces = true;
      ok(`Configuration set "${configSet}" publishes ${types.join(", ")}`);
    }
    for (const d of enabled) {
      const arn = d.SnsDestination?.TopicArn;
      if (arn) topicArns.push(arn);
      info(`destination: ${d.Name} -> ${arn || d.EventBridgeDestination?.EventBusArn || "(non-SNS destination)"}`);
    }
    if (enabled.length && !topicArns.length) {
      bad("No SNS destination — only SNS reaches /api/email/webhooks/ses.");
      publishesBounces = false;
    }
    if (expectedArn && topicArns.length && !topicArns.includes(expectedArn)) {
      bad(`SNS_TOPIC_ARN does not match the topic SES publishes to.`);
      info(`  env:  ${expectedArn}`);
      info(`  SES:  ${topicArns.join(", ")}`);
      info("The webhook rejects every event from a topic other than SNS_TOPIC_ARN (403).");
    }
  } catch (e) {
    bad(`Could not read configuration set "${configSet}": ${e.name === "NotFoundException" ? "it does not exist in this region" : e.message}`);
  }
}

if (ses) {
  try {
    const acct = await ses.send(new GetAccountCommand({}));
    const q = acct.SendQuota || {};
    info(`sending enabled: ${acct.SendingEnabled}   production access: ${acct.ProductionAccessEnabled ? "yes" : "NO (sandbox)"}`);
    info(`24h quota: ${q.SentLast24Hours ?? "?"} / ${q.Max24HourSend ?? "?"}`);
    if (acct.EnforcementStatus && acct.EnforcementStatus !== "HEALTHY") {
      bad(`SES account enforcement status: ${acct.EnforcementStatus}`);
    }
    if (acct.SuppressionAttributes?.SuppressedReasons?.length) {
      info(`account suppression list auto-adds: ${acct.SuppressionAttributes.SuppressedReasons.join(", ")}`);
      info("SES bounces these instantly, without attempting delivery — which is");
      info("what a burst of identically-timestamped bounce notices looks like.");
    }
  } catch (e) {
    warn(`GetAccount failed: ${e.message}`);
  }
}

// ------------------------------------------------------- 2. SNS -> the app
h("2. Does SNS actually deliver to the webhook?");

let subscriptionConfirmed = false;

if (!hasCreds || !topicArns.length) {
  info("(skipped — need AWS credentials and an SNS destination)");
} else {
  const sns = new AWS.SNS({ region, ...creds });
  for (const arn of topicArns) {
    try {
      let token;
      const subs = [];
      do {
        const r = await sns.listSubscriptionsByTopic({ TopicArn: arn, NextToken: token }).promise();
        subs.push(...(r.Subscriptions || []));
        token = r.NextToken;
      } while (token);

      if (!subs.length) {
        bad(`Topic ${arn} has NO subscriptions.`);
        info("SES publishes each bounce to this topic and it goes nowhere.");
        info(`Create one: SNS -> this topic -> Create subscription -> HTTPS ->`);
        info(`  ${webhookUrl || "https://<your-domain>/api/email/webhooks/ses"}`);
        continue;
      }
      for (const s of subs) {
        const pending = s.SubscriptionArn === "PendingConfirmation";
        const line = `${s.Protocol} -> ${s.Endpoint}`;
        if (pending) {
          bad(`PENDING CONFIRMATION: ${line}`);
          info("A pending subscription delivers nothing. Deleting and recreating it");
          info("makes SNS re-send the confirmation, which the webhook auto-accepts.");
        } else if (s.Protocol === "https" && String(s.Endpoint).includes("/api/email/webhooks/ses")) {
          subscriptionConfirmed = true;
          ok(`confirmed: ${line}`);
        } else {
          info(`confirmed (not the webhook): ${line}`);
        }
      }
      if (subs.length && !subscriptionConfirmed && !subs.some((s) => s.SubscriptionArn === "PendingConfirmation")) {
        bad("No confirmed HTTPS subscription pointing at /api/email/webhooks/ses.");
      }
    } catch (e) {
      warn(`Could not list subscriptions for ${arn}: ${e.message}`);
      if (/AuthorizationError|not authorized/i.test(e.message)) {
        info("The IAM user needs sns:ListSubscriptionsByTopic.");
      }
    }
  }
}

// Is the endpoint reachable and running the current build?
if (webhookUrl) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Type: "Diagnostic", MessageId: "probe" }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 403) {
      ok(`endpoint answers (403 — signature check active, current build deployed)`);
    } else if (res.status === 404) {
      bad(`endpoint returns 404 — the route is missing. Is the build deployed and pm2 restarted?`);
    } else if (res.status >= 500) {
      bad(`endpoint returns ${res.status} — SNS will treat this as a failed delivery.`);
    } else {
      info(`endpoint answers HTTP ${res.status}`);
    }
  } catch (e) {
    bad(`${webhookUrl} is not reachable from this server: ${e.message}`);
    info("SNS calls it from the public internet, so it must be reachable there too.");
  }
}

// ------------------------------------------------------------------- 3. db
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

h("3. Has this app ever recorded a bounce?");

// Authoritative across all time: every version of the webhook has set these.
const [[st]] = await conn.query(
  `SELECT
     SUM(status = 'bounced')     AS bounced,
     SUM(status = 'complained')  AS complained,
     SUM(status = 'delivered')   AS delivered,
     MAX(bounced_at)             AS last_bounce
   FROM campaign_recipients`
);
const everRecorded =
  Number(st?.bounced || 0) + Number(st?.complained || 0) + Number(st?.delivered || 0);

if (everRecorded === 0) {
  bad("No recipient has EVER been marked bounced, complained, or delivered.");
  info("Every version of the webhook writes these, so this covers all history:");
  info("SES has never successfully POSTed to the webhook.");
} else {
  ok(`recorded: ${st.bounced || 0} bounced, ${st.complained || 0} complained, ${st.delivered || 0} delivered`);
  info(`most recent bounce: ${st.last_bounce || "(never)"}`);
}

// Secondary signal — only the current build writes campaign_events, so a zero
// here means nothing on its own if the build is new.
const [[ev]] = await conn.query(
  `SELECT COUNT(*) AS n, MAX(created_at) AS last_event
     FROM campaign_events WHERE kind IN ('bounce','complaint','delivery')`
);
info(`campaign_events rows (current build only): ${ev?.n || 0}${ev?.last_event ? `, latest ${ev.last_event}` : ""}`);

// -------------------------------------------------------- 4. SES vs the app
h("4. What is SES already refusing to deliver to?");

const sesSuppressed = new Map();
let listComplete = false;
if (ses) {
  try {
    let nextToken;
    let page = 0;
    do {
      // Roughly one call per second is allowed; pace it or the list comes back
      // partial, and the addresses that never arrived are exactly the ones that
      // stay mailable and keep bouncing.
      if (page++ > 0) await sleep(1100);
      const res = await withThrottleRetry(() =>
        ses.send(new ListSuppressedDestinationsCommand({ PageSize: 1000, NextToken: nextToken }))
      );
      for (const d of res.SuppressedDestinationSummaries ?? []) {
        if (d?.EmailAddress) sesSuppressed.set(String(d.EmailAddress).toLowerCase(), String(d.Reason || "BOUNCE"));
      }
      nextToken = res.NextToken;
      if (nextToken) process.stdout.write(`\r           reading… ${sesSuppressed.size}`);
    } while (nextToken);
    process.stdout.write("\r");
    listComplete = true;
    info(`SES account suppression list: ${sesSuppressed.size} address(es)`);
  } catch (e) {
    process.stdout.write("\r");
    warn(`SES suppression list read failed after ${sesSuppressed.size}: ${e.message}`);
    info("Counts below are a FLOOR — the real number is higher.");
    if (/not authorized|AccessDenied/i.test(e.message)) info("The IAM user needs ses:ListSuppressedDestinations.");
  }
}

if (sesSuppressed.size) {
  const all = [...sesSuppressed.keys()];
  // One query per address made this crawl; do it set-wise instead.
  const mailed = [];
  for (const chunk of chunks(all, 500)) {
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(
      `SELECT DISTINCT LOWER(cr.email) AS email, c.user_id
         FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE LOWER(cr.email) IN (${ph})`,
      chunk
    );
    mailed.push(...rows);
  }

  const blocked = new Set();
  for (const chunk of chunks(mailed, 500)) {
    const ph = chunk.map(() => "(?,?)").join(",");
    const params = [];
    for (const r of chunk) params.push(r.user_id, r.email);
    const [rows] = await conn.query(
      `SELECT user_id, value FROM suppressions
        WHERE type = 'email'
          AND (corrected IS NULL OR corrected = 0)
          AND (user_id, value) IN (${ph})`,
      params
    );
    for (const r of rows) blocked.add(`${r.user_id}|${r.value}`);
  }

  const stillMailable = mailed.filter((r) => !blocked.has(`${r.user_id}|${r.email}`));
  info(`of those, mailed by this app: ${mailed.length}`);
  if (stillMailable.length) {
    bad(`${stillMailable.length} are NOT blocked here — the next campaign mails them again, and SES bounces every one instantly.`);
    info("Fix now:  node scripts/import-ses-suppressions.mjs");
    info(`examples: ${stillMailable.slice(0, 12).map((r) => r.email).join(", ")}`);
  } else {
    ok("Every SES-suppressed address this app has mailed is blocked here.");
  }
  if (!listComplete) info("(remember: partial list, so the real backlog is larger)");
}

// --------------------------------------------------------- 5. what bounced
h(`5. Recipient outcomes, last ${DAYS} days`);

const [statuses] = await conn.query(
  `SELECT status, COUNT(*) AS n FROM campaign_recipients
    WHERE created_at >= (NOW() - INTERVAL ? DAY)
    GROUP BY status ORDER BY n DESC`,
  [DAYS]
);
if (!statuses.length) info("(no recipients in this window)");
for (const r of statuses) info(`${String(r.status).padEnd(12)} ${r.n}`);

const [reasons] = await conn.query(
  `SELECT LEFT(COALESCE(error_reason, '(no reason recorded)'), 90) AS reason, COUNT(*) AS n
     FROM campaign_recipients
    WHERE status IN ('bounced','complained','failed')
      AND created_at >= (NOW() - INTERVAL ? DAY)
    GROUP BY reason ORDER BY n DESC LIMIT 15`,
  [DAYS]
);
if (reasons.length) {
  console.log("\n  Why they failed:");
  for (const r of reasons) info(`${String(r.n).padStart(5)}  ${r.reason}`);
}

const [domains] = await conn.query(
  `SELECT SUBSTRING_INDEX(email, '@', -1) AS domain, COUNT(*) AS total,
          SUM(status IN ('bounced','failed','complained')) AS failed
     FROM campaign_recipients
    WHERE created_at >= (NOW() - INTERVAL ? DAY)
    GROUP BY domain HAVING failed > 0 ORDER BY failed DESC LIMIT 15`,
  [DAYS]
);
if (domains.length) {
  console.log("\n  Worst recipient domains:");
  for (const d of domains) info(`${String(d.failed).padStart(5)} / ${String(d.total).padEnd(6)} ${d.domain}`);
}

// --------------------------------------------------------------- 6. verdict
h("Verdict");

if (!publishesBounces) {
  bad("SES is not publishing bounce events at all.");
  console.log(`
  In the SES console (region ${region}): create a configuration set with an
  SNS event destination covering BOUNCE, COMPLAINT, DELIVERY and REJECT, then
  set SES_CONFIG_SET on the server and restart.`);
} else if (!subscriptionConfirmed) {
  bad("SES publishes the events, but no confirmed subscription carries them to the app.");
  console.log(`
  This is the break. SES is doing its part; the SNS topic is the dead end.

    1. SNS console (${region}) -> Topics -> ${topicArns[0] || "the topic above"}
       -> Subscriptions.
    2. If there is no HTTPS subscription, or one stuck on "Pending
       confirmation", delete it and create it again:
         Protocol: HTTPS
         Endpoint: ${webhookUrl || "https://<your-domain>/api/email/webhooks/ses"}
       Leave "Enable raw message delivery" OFF — the webhook needs the SNS
       envelope to verify the signature.
    3. The webhook confirms the subscription by itself. Refresh; it should
       show a real ARN rather than "Pending confirmation".
    4. Send one test campaign to a known-bad address and re-run this script.

  Until then, block the backlog SES already knows about:
      node scripts/import-ses-suppressions.mjs
  Those addresses are bounced by SES instantly, without a delivery attempt,
  which is why they arrive as a burst on one timestamp.`);
} else if (everRecorded === 0) {
  warn("The subscription is confirmed, but nothing has been recorded yet.");
  console.log(`
  Check SNS -> topic -> Subscriptions -> the subscription -> Delivery status
  logs for HTTP error codes. A 403 means the webhook rejected the signature:
  confirm SNS_TOPIC_ARN matches ${topicArns[0] || "the publishing topic"}, or
  unset it to accept any topic. Then send a test campaign and re-run.`);
} else {
  ok("Bounce feedback is reaching this app and being recorded.");
  console.log(`
  Remaining MAILER-DAEMON emails are SES feedback forwarding, which stays on
  independently: SES -> Identities -> your domain -> Feedback forwarding ->
  disable. Only do that once the numbers above are moving.`);
}

await conn.end();

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isThrottle(e) {
  const name = String(e?.name || e?.Code || "");
  return (
    name === "TooManyRequestsException" ||
    name === "ThrottlingException" ||
    name === "LimitExceededException" ||
    /rate exceeded|throttl/i.test(String(e?.message || ""))
  );
}

async function withThrottleRetry(fn, attempts = 6) {
  let delay = 1000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !isThrottle(e)) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}
