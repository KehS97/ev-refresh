// EV Charger Availability Monitor — GitHub Actions version
//
// Polls the Regatta EVCMS overview API and pushes an ntfy.sh notification
// the moment a charging spot flips to "Available". Runs on a schedule via
// .github/workflows/poll.yml.
//
// Required environment variables (set as GitHub Actions repo secrets):
//   COGNITO_REFRESH_TOKEN, NTFY_TOPIC
//
// State (last-seen status per connector) is kept in state.json, which the
// workflow commits back to the repo only when something actually changes.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const AVAILABLE_STATUS = "Available";
const COGNITO_CLIENT_ID = "6mbpildnjj725vhpe16409llfq";
const COGNITO_OAUTH_DOMAIN = "evcms-rtta.auth.ap-southeast-1.amazoncognito.com";
const OVERVIEW_URL =
  "https://evcms-api.energie.co.id/regatta/get/overview?code=regaatax8w1750O0wqex2lw8327150e998";
const STATE_FILE = new URL("./state.json", import.meta.url);

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
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

async function main() {
  const state = loadState();
  const accessToken = await getAccessToken();
  const statuses = await fetchConnectorStatuses(accessToken);

  let changed = false;

  for (const conn of statuses) {
    const previous = state[conn.connectorId];

    if (conn.status === AVAILABLE_STATUS && previous !== AVAILABLE_STATUS) {
      console.log(`${conn.station} just became available — notifying.`);
      await notify(`${conn.station} just became available.`);
    }

    if (conn.status !== previous) {
      state[conn.connectorId] = conn.status;
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
