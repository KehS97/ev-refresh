# EV Charger Monitor

Polls the Regatta EVCMS site roughly every minute and sends a phone push
when BASEMENT 1 or BASEMENT 2 is "Available". The actual polling and
notifying runs as a GitHub Actions workflow (works without your computer
being on); a small Cloudflare Worker exists purely to trigger it reliably.

## Why two moving parts

GitHub's own `schedule:` cron trigger turned out to be unreliable in
practice — a `*/5 * * * *` schedule was observed running hours apart
instead of every 5 minutes, and GitHub doesn't guarantee timing for it.
Cloudflare Cron Triggers are precise, but a Cloudflare Worker can't be used
for the notification itself here because ntfy.sh blocks/drops requests
from Cloudflare's network (confirmed via testing — other hosts like
`api.github.com` and `api.telegram.org` work fine from a Worker, only
`ntfy.sh` doesn't).

So the split is: **`trigger-worker/`** (Cloudflare Worker, precise 1-minute
cron) calls GitHub's `workflow_dispatch` API to say "run now" — it never
touches ntfy.sh. The actual work — Cognito auth, status check, and the
ntfy push — all happens inside **the GitHub Actions workflow**
(`poll.js` / `.github/workflows/poll.yml`), where ntfy.sh is reachable.
The repo is public so this can run every minute without hitting GitHub's
free Actions-minutes cap (private repos: 2,000 min/month; public repos:
unlimited). No secrets live in the code either way — only in each
platform's encrypted secret store.

## How it works

The Regatta web app (regatta.energie.co.id/evgate) calls a JSON API at
`evcms-api.energie.co.id` for the charger overview, authenticated via AWS
Cognito (Hosted UI / federated Google login). `poll.js` replays that same
call on a schedule:

1. Check whether GitHub Issue #1 ("Charger monitoring") is open — if it's
   closed, stop here.
2. Exchange a saved Cognito **refresh token** for a fresh access token via
   the Cognito OAuth token endpoint.
3. Call the overview API with that access token.
4. Read each connector's `status` field (`Available`, `Charging`,
   `Preparing`, `SuspendedEV`, `Offline`).
5. If a connector is `Available`, push a notification via
   [ntfy.sh](https://ntfy.sh) — up to 3 times per availability window (the
   first ping plus 2 reminders on later polls), then it stays quiet until
   the connector goes unavailable and becomes available again. If it goes
   unavailable again *before* the 3rd ping (someone else took the spot),
   it pushes a "no longer available" notice instead, so you're not driving
   over or waiting on something that's already gone. Once the cap is
   reached, it stays fully silent either way — no "gone" notice either,
   since by then you may not even be planning to charge anymore.
6. Remember status + notify count in `state.json`, committed back to the
   repo only when something actually changed.

## Turning notifications on/off

GitHub Issue #1 ("Charger monitoring") in this repo is the toggle:
**open = notifications on, closed = notifications off.** The poller checks
its state on every run and skips entirely when closed.

To flip it, open the issue in the GitHub app (or
https://github.com/KehS97/ev-refresh/issues/1) and tap the native
**Close issue** / **Reopen issue** button at the bottom — no typing, one
tap. Bookmark that URL to your home screen for quick access.

## One-time setup

### 1. Install the ntfy app on your phone

- iOS: App Store → "ntfy"
- Android: Play Store → "ntfy", or F-Droid

Subscribe to your private topic name (the one you already picked). Anyone
who knows the topic name can read/send to it, so don't use something
guessable.

### 2. Get a Cognito refresh token

1. Sign in at https://regatta.energie.co.id (the "Sign In with Gmail"
   button).
2. Open DevTools → Application tab → Local Storage →
   `https://regatta.energie.co.id`.
3. Find the key that ends in `.refreshToken` (starts with
   `CognitoIdentityServiceProvider.6mbpildnjj725vhpe16409llfq...`).
   Right-click the row → "Copy value" (don't select manually — it's ~1700
   characters and manual selection tends to truncate it).

This token is a credential — treat it like a password. It only goes into a
GitHub Actions **encrypted secret**, never committed to the repo.

Note: Cognito refresh tokens typically expire after ~30 days. If the
workflow starts failing, repeat this step and update the secret.

### 3. Repo secrets

Repo → Settings → Secrets and variables → Actions → "New repository
secret":

- `COGNITO_REFRESH_TOKEN` — the value from step 2
- `NTFY_TOPIC` — your ntfy topic name from step 1

### 4. Deploy the trigger Worker

From `trigger-worker/`:

```bash
npm install
npx wrangler login
```

Create a GitHub fine-grained access token at
https://github.com/settings/personal-access-tokens/new — scope it to only
this repo, with **Actions: Read and write** permission and nothing else.
Then:

```bash
npx wrangler secret put GITHUB_TOKEN   # paste the token when prompted
npx wrangler deploy
```

`wrangler.toml` already sets the cron (`* * * * *`) and the target repo
(`GITHUB_REPO` var). Once deployed, it calls this repo's
`workflow_dispatch` endpoint every minute.

## Charging status email alerts

Separate from charger availability: Regatta emails
`admin-regatta@harapanenergie.com` with subject "⚠️ WARNING: Your EV is
fully charged" when charging finishes, and "EV Has Stop Charging !!!!" if
charging stops for any reason. iOS Shortcuts' "when I get an email"
automation can only check every ~15 minutes (an iOS limit, not something a
shortcut can change), so instead `gmail-alert/Code.gs` — a Google Apps
Script running under your own Gmail account, no credentials leave Google —
checks for either email every minute.

It doesn't push to ntfy directly — testing showed ntfy.sh rate-limits Apps
Script's shared outbound IP pool (429s, then connection failures), the
same fundamental problem as the Cloudflare Worker earlier, just a
different failure mode. Instead it dispatches
`.github/workflows/notify.yml`, a small workflow that just relays a
title/message to ntfy from GitHub's network (reachable, like everything
else here). Matched emails get an `ev-notified` Gmail label so they don't
re-trigger.

Setup:

1. Go to https://script.google.com → New project.
2. Delete the default code, paste in the contents of `gmail-alert/Code.gs`.
3. Save (Ctrl+S) — the function dropdown stays empty/greyed out until the
   file is saved.
4. Project Settings (gear icon, left sidebar) → Script Properties → Add
   property: name `GITHUB_TOKEN`, value = the same fine-grained GitHub
   token created for the trigger Worker (repo: `ev-refresh`, permission:
   Actions read/write) — reuse it, no need for a second token.
5. Run the `checkForChargingEmails` function once from the editor (▶ button)
   — it'll prompt to authorize Gmail access for the script; approve it.
6. Run the `installTrigger` function once (switch the function dropdown at
   the top, then ▶) — this installs the 1-minute recurring trigger. You can
   verify it under the clock icon ("Triggers") in the left sidebar.

You can drop the Shortcuts automation entirely once this is confirmed
working — the ntfy push replaces it.

## Testing

From the Actions tab, click "Run workflow" to trigger it on demand and
watch the logs — it prints each connector's current status, and logs
"notifying" if it fires a push. Check the optional "Send a one-off test
push" box to exercise just the ntfy path without needing a real status
change.

## Files

- `poll.js` — the polling + notification logic (Node 20+, no dependencies)
- `state.json` — last-seen status + notify count per connector, updated by
  the workflow
- GitHub Issue #1 — the on/off switch (open = on, closed = off)
- `.github/workflows/poll.yml` — the workflow_dispatch trigger and commit-back step
- `trigger-worker/` — the Cloudflare Worker that fires the workflow on a precise 1-minute cron
