// EV Charger Availability Monitor — GitHub Actions version
//
// Polls the Regatta EVCMS overview API and pushes an ntfy.sh notification
// when a charging spot is "Available". Runs on a schedule via
// .github/workflows/poll.yml.
//
// Required environment variables (set as GitHub Actions repo secrets):
//   COGNITO_REFRESH_TOKEN, NTFY_TOPIC
//
// State (status + notify count per connector) is kept in state.json, which
// the workflow commits back to the repo only when something actually
// changes.
//
// The on/off switch is GitHub Issue #1 ("Charger monitoring") in this repo:
// open = notifications on, closed = notifications off. Toggle it from the
// GitHub mobile app's native Close/Reopen issue button — no typing needed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const AVAILABLE_STATUS = "Available";
const MAX_NOTIFICATIONS_PER_WINDOW = 3; // the initial ping + 2 reminders
const COGNITO_CLIENT_ID = "6mbpildnjj725vhpe16409llfq";
const COGNITO_OAUTH_DOMAIN = "evcms-rtta.auth.ap-southeast-1.amazoncognito.com";
const OVERVIEW_URL =
  "https://evcms-api.energie.co.id/regatta/get/overview?code=regaatax8w1750O0wqex2lw8327150e998";
const STATE_FILE = new URL("./state.json", import.meta.url);
const GITHUB_REPO = "KehS97/ev-refresh";
const MONITORING_TOGGLE_ISSUE = 1;

async function getAccessToken() {
  const res = await fetch(`https://${COGNITO_OAUTH_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: COGNITO_CLIENT_ID,
      refresh_token: process.env.COGNITO_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) {
    throw new Error(`Cognito refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchConnectorStatuses(accessToken) {
  const res = await fetch(OVERVIEW_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Overview fetch failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const locations = data.message.new_location || [];

  const statuses = [];
  for (const location of locations) {
    for (const station of location.chargestation || []) {
      for (const connector of station.connector || []) {
        statuses.push({
          station: station.name,
          connectorId: connector.id,
          status: connector.status,
        });
      }
    }
  }
  return statuses;
}

async function notify(text) {
  const topic = process.env.NTFY_TOPIC.trim();
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ev-charger-monitor/1.0)",
      Title: "EV charger available",
      Priority: "urgent",
      Tags: "zap",
    },
    body: text,
  });
  if (!res.ok) {
    throw new Error(`ntfy push failed (${res.status}): ${await res.text()}`);
  }
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));

  // Migrate the old format (bare status string per connector) transparently.
  const migrated = {};
  for (const [id, value] of Object.entries(raw)) {
    migrated[id] =
      typeof value === "string" ? { status: value, notifyCount: 0 } : value;
  }
  return migrated;
}

async function isMonitoringEnabled() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues/${MONITORING_TOGGLE_ISSUE}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ev-charger-monitor",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to check toggle issue state (${res.status}): ${await res.text()}`);
  }

  const issue = await res.json();
  return issue.state === "open";
}

async function main() {
  if (process.env.TEST_NOTIFY === "1") {
    console.log("TEST_NOTIFY=1 set — sending a test push and exiting.");
    await notify("Test notification from EV charger monitor.");
    console.log("Test push sent.");
    return;
  }

  if (!(await isMonitoringEnabled())) {
    console.log(
      `Monitoring is off (issue #${MONITORING_TOGGLE_ISSUE} is closed). Skipping poll.`
    );
    return;
  }

  const state = loadState();
  const accessToken = await getAccessToken();
  const statuses = await fetchConnectorStatuses(accessToken);

  let changed = false;

  for (const conn of statuses) {
    const previous = state[conn.connectorId] || { status: null, notifyCount: 0 };
    let notifyCount = previous.notifyCount || 0;

    if (conn.status === AVAILABLE_STATUS) {
      if (previous.status !== AVAILABLE_STATUS) {
        notifyCount = 0; // a fresh availability window just started
      }
      if (notifyCount < MAX_NOTIFICATIONS_PER_WINDOW) {
        notifyCount += 1;
        console.log(
          `${conn.station} is available — notifying (${notifyCount}/${MAX_NOTIFICATIONS_PER_WINDOW}).`
        );
        await notify(
          `${conn.station} is available. (Reminder ${notifyCount}/${MAX_NOTIFICATIONS_PER_WINDOW})`
        );
      } else {
        console.log(`${conn.station} still available — notification cap reached, staying quiet.`);
      }
    } else {
      notifyCount = 0; // reset so the next availability window notifies fresh
    }

    if (conn.status !== previous.status || notifyCount !== previous.notifyCount) {
      state[conn.connectorId] = { status: conn.status, notifyCount };
      changed = true;
    }

    console.log(`${conn.station} (${conn.connectorId}): ${conn.status}`);
  }

  if (changed) {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
    console.log("STATE_CHANGED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
