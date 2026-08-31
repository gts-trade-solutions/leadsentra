#!/usr/bin/env node
//
// One-shot report on the bounce feedback loop: what is configured, what SES
// knows, and what the app has actually recorded.
//
// Run this on the server when bounce notices keep arriving in the sender's
// inbox. It answers, in order:
//
//   1. Is SES routing events to the app at all, or emailing them to the sender?
//   2. Has the webhook EVER fired? (the single most telling number here)
//   3. How many addresses is SES already refusing, and how many are still
//      mailable in this app?
//   4. What is actually bouncing, and why?
//
// Read-only. Changes nothing.
//
// Usage: node scripts/diagnose-bounces.mjs [days]      (default: 14)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
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

info(`region        ${region}`);
info(`app url       ${appUrl || "(not set)"}`);
hasCreds ? ok("AWS credentials present") : bad("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing");

let ses = null;
if (hasCreds) {
  ses = new SESv2Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

let feedbackLive = false;
if (!configSet) {
  bad("SES_CONFIG_SET is not set.");
  info("This is why bounce notices arrive in the sender's mailbox: with no");
  info("configuration set, SES uses email feedback forwarding and never calls");
  info(`${appUrl || "<APP_URL>"}/api/email/webhooks/ses.`);
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
      info("It behaves exactly like having no configuration set at all.");
    } else if (!types.includes("BOUNCE") || !types.includes("COMPLAINT")) {
      bad(`Configuration set "${configSet}" publishes ${types.join(", ")} — missing BOUNCE and/or COMPLAINT.`);
    } else {
      feedbackLive = true;
      ok(`Configuration set "${configSet}" publishes ${types.join(", ")}`);
      for (const d of enabled) {
        const dest = d.SnsDestination?.TopicArn || d.EventBridgeDestination?.EventBusArn || "(non-SNS destination)";
        info(`destination: ${d.Name} -> ${dest}`);
      }
      if (!enabled.some((d) => d.SnsDestination?.TopicArn)) {
        warn("No SNS destination — only SNS reaches /api/email/webhooks/ses.");
        feedbackLive = false;
      }
    }
  } catch (e) {
    bad(`Could not read configuration set "${configSet}": ${e.name === "NotFoundException" ? "it does not exist in this region" : e.message}`);
    info("Every send names this set. If it does not exist, sends fail outright.");
  }
}

if (ses) {
  try {
    const acct = await ses.send(new GetAccountCommand({}));
    const st = acct.SendQuota || {};
    info(`sending enabled: ${acct.SendingEnabled}   production access: ${!acct.ProductionAccessEnabled ? "NO (sandbox)" : "yes"}`);
    info(`24h quota: ${st.SentLast24Hours ?? "?"} / ${st.Max24HourSend ?? "?"}`);
    if (acct.EnforcementStatus && acct.EnforcementStatus !== "HEALTHY") {
      bad(`SES account enforcement status: ${acct.EnforcementStatus}`);
    }
    if (acct.SuppressionAttributes?.SuppressedReasons?.length) {
      info(`account suppression list auto-adds: ${acct.SuppressionAttributes.SuppressedReasons.join(", ")}`);
    }
  } catch (e) {
    warn(`GetAccount failed: ${e.message}`);
  }
}

// ------------------------------------------------------------------- 2. db
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

h("2. Has the bounce webhook EVER recorded anything?");

const [[ev]] = await conn.query(
  `SELECT
     SUM(kind = 'bounce')    AS bounces,
     SUM(kind = 'complaint') AS complaints,
     SUM(kind = 'delivery')  AS deliveries,
     MAX(created_at)         AS last_event
   FROM campaign_events
   WHERE kind IN ('bounce','complaint','delivery')`
);
const webhookEvents = Number(ev?.bounces || 0) + Number(ev?.complaints || 0) + Number(ev?.deliveries || 0);

const [[st]] = await conn.query(
  `SELECT
     SUM(status = 'bounced')    AS bounced,
     SUM(status = 'complained') AS complained,
     SUM(bounced_at IS NOT NULL) AS with_bounce_ts,
     MAX(bounced_at)            AS last_bounce
   FROM campaign_recipients`
);

if (webhookEvents === 0) {
  bad("Zero delivery/bounce/complaint events have ever been written by the webhook.");
  info("SES has never successfully POSTed to /api/email/webhooks/ses.");
  info("Every bounce so far went to the sender's inbox instead.");
} else {
  ok(`webhook events recorded: ${ev.bounces || 0} bounce, ${ev.complaints || 0} complaint, ${ev.deliveries || 0} delivery`);
  info(`most recent: ${ev.last_event}`);
}
info(`recipient rows marked bounced: ${st?.bounced || 0}, complained: ${st?.complained || 0}`);
info(`most recent bounce timestamp: ${st?.last_bounce || "(never)"}`);

// -------------------------------------------------------- 3. SES vs the app
h("3. What is SES already refusing to deliver to?");

let sesSuppressed = new Map();
if (ses) {
  try {
    let nextToken;
    do {
      const res = await ses.send(
        new ListSuppressedDestinationsCommand({ PageSize: 1000, NextToken: nextToken })
      );
      for (const d of res.SuppressedDestinationSummaries ?? []) {
        if (d?.EmailAddress) {
          sesSuppressed.set(String(d.EmailAddress).toLowerCase(), String(d.Reason || "BOUNCE"));
        }
      }
      nextToken = res.NextToken;
    } while (nextToken);
    info(`SES account suppression list: ${sesSuppressed.size} address(es)`);
  } catch (e) {
    warn(`Could not read the SES suppression list: ${e.message}`);
    if (/not authorized|AccessDenied/i.test(e.message)) {
      info("The IAM user needs ses:ListSuppressedDestinations.");
    }
  }
}

if (sesSuppressed.size) {
  const all = [...sesSuppressed.keys()];
  let mailedByUs = 0;
  let stillMailable = 0;
  const examples = [];
  for (const chunk of chunks(all, 500)) {
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(
      `SELECT DISTINCT LOWER(cr.email) AS email, c.user_id
         FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE LOWER(cr.email) IN (${ph})`,
      chunk
    );
    mailedByUs += rows.length;
    for (const r of rows) {
      const [[s]] = await conn.query(
        `SELECT COUNT(*) AS n FROM suppressions
          WHERE user_id = ? AND type = 'email' AND value = ?
            AND (corrected IS NULL OR corrected = 0)`,
        [r.user_id, r.email]
      );
      if (!Number(s?.n || 0)) {
        stillMailable++;
        if (examples.length < 15) examples.push(r.email);
      }
    }
  }
  info(`of those, mailed by this app: ${mailedByUs}`);
  if (stillMailable > 0) {
    bad(`${stillMailable} are NOT blocked in this app — the next campaign will mail them again.`);
    info("Fix now:  node scripts/import-ses-suppressions.mjs");
    info(`examples: ${examples.join(", ")}`);
  } else {
    ok("Every SES-suppressed address this app has mailed is blocked here.");
  }
}

// --------------------------------------------------------- 4. what bounced
h(`4. Recipient outcomes, last ${DAYS} days`);

const [statuses] = await conn.query(
  `SELECT status, COUNT(*) AS n
     FROM campaign_recipients
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
  `SELECT SUBSTRING_INDEX(email, '@', -1) AS domain,
          COUNT(*) AS total,
          SUM(status IN ('bounced','failed','complained')) AS failed
     FROM campaign_recipients
    WHERE created_at >= (NOW() - INTERVAL ? DAY)
    GROUP BY domain HAVING failed > 0
    ORDER BY failed DESC LIMIT 15`,
  [DAYS]
);
if (domains.length) {
  console.log("\n  Worst recipient domains:");
  for (const d of domains) info(`${String(d.failed).padStart(5)} / ${String(d.total).padEnd(6)} ${d.domain}`);
}

// --------------------------------------------------------------- 5. verdict
h("Verdict");

if (!feedbackLive) {
  bad("Bounce feedback is NOT reaching this app.");
  console.log(`
  Nothing in the application can stop the MAILER-DAEMON emails arriving in
  the sender's inbox. That is SES email feedback forwarding, and it is on
  precisely because no configuration set publishes the events instead.

  In the SES console (region ${region}):
    1. Configuration sets -> create one, e.g. EmailTrackingSet
    2. Event destinations -> add -> Amazon SNS -> new topic
       event types: BOUNCE, COMPLAINT, DELIVERY, REJECT
    3. SNS -> that topic -> Create subscription -> HTTPS ->
       ${appUrl || "https://<your-domain>"}/api/email/webhooks/ses
       (it confirms itself; no manual step)
    4. On the server, add to the env and restart:
         SES_CONFIG_SET=EmailTrackingSet
         SNS_TOPIC_ARN=<the topic arn>
       pm2 restart leadsentra --update-env
    5. Optional, once confirmed working: SES -> Identities -> your domain ->
       Feedback forwarding -> disable, to stop the emails entirely.

  Then re-run this script; section 2 should start counting events.`);
} else if (webhookEvents === 0) {
  warn("SES is configured to publish events, but this app has never received one.");
  console.log(`
  The configuration set is right, so the break is between SNS and the app.
  Check, in order:
    - SNS -> topic -> Subscriptions: is the HTTPS subscription "Confirmed"?
      A subscription stuck on "Pending confirmation" delivers nothing.
    - Is ${appUrl || "<APP_URL>"}/api/email/webhooks/ses reachable from the
      public internet (not behind basic auth, not an internal-only host)?
    - SNS -> topic -> Delivery status logs, for HTTP error codes. A 403 here
      means the signature check rejected it; confirm SNS_TOPIC_ARN matches
      the topic actually sending.`);
} else {
  ok("Bounce feedback is reaching this app and being recorded.");
  console.log(`
  Remaining MAILER-DAEMON emails are SES feedback forwarding, which stays on
  until you disable it: SES -> Identities -> your domain -> Feedback
  forwarding -> disable. The app already has the data either way.`);
}

await conn.end();

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
