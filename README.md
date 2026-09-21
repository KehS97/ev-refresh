# EV Charger Monitor

Polls the Regatta EVCMS site every 5 minutes and sends a phone push when
BASEMENT 1 or BASEMENT 2 is "Available". Runs as a GitHub Actions scheduled
workflow so it works without your computer being on.

Note: `*/5 * * * *` is the shortest cron interval GitHub Actions actually
runs — a `* * * * *` (every minute) schedule was tried first and never
fired once in ~18 hours, so treat sub-5-minute schedules as effectively
unsupported rather than just "delayed." If you need tighter timing, the
fallback is a real always-on host: a Cloudflare Worker (this repo had one —
removed because ntfy.sh blocks Cloudflare's network) paired with a
notification service that isn't Cloudflare-hosted, e.g. a Telegram bot via
`api.telegram.org`, which responded fine in testing.

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
   the connector goes unavailable and becomes available again.
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
- `.github/workflows/poll.yml` — the schedule and commit-back step
