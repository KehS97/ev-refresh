# EV Charger Monitor

Polls the Regatta EVCMS site every 5 minutes and sends a phone push the
instant BASEMENT 1 or BASEMENT 2 becomes "Available". Runs as a GitHub
Actions scheduled workflow so it works without your computer being on.

(An earlier version of this ran on Cloudflare Workers, but ntfy.sh
consistently refused connections from Cloudflare's network — see git
history / worker.js if you ever want to revisit that approach with a
different push service.)

## How it works

The Regatta web app (regatta.energie.co.id/evgate) calls a JSON API at
`evcms-api.energie.co.id` for the charger overview, authenticated via AWS
Cognito (Hosted UI / federated Google login). `poll.js` replays that same
call on a schedule:

1. Exchange a saved Cognito **refresh token** for a fresh access token via
   the Cognito OAuth token endpoint.
2. Call the overview API with that access token.
3. Read each connector's `status` field (`Available`, `Charging`,
   `Preparing`, `SuspendedEV`, `Offline`).
4. If a connector just changed *to* `Available`, push a notification via
   [ntfy.sh](https://ntfy.sh).
5. Remember the new state in `state.json`, committed back to the repo only
   when something actually changed, so it doesn't repeat the notification
   every run.

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

### 3. Push this repo to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Create an empty repo on github.com (private is fine — no need to make it
public), then:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

### 4. Add repo secrets

On GitHub: repo → Settings → Secrets and variables → Actions → "New
repository secret". Add two:

- `COGNITO_REFRESH_TOKEN` — the value from step 2
- `NTFY_TOPIC` — your ntfy topic name from step 1

### 5. Enable the workflow

Actions run automatically once the workflow file is on the default branch.
Go to the repo's **Actions** tab, select "Poll EV charger status", and you
should see it listed as scheduled (every 5 minutes) with a "Run workflow"
button for manual testing.

## Testing

From the Actions tab, click "Run workflow" to trigger it on demand and
watch the logs — it prints each connector's current status, and logs
"notifying" if it fires a push.

To test the push path itself without waiting for a real status change, you
can temporarily edit `state.json` to a non-`Available` value for one of the
connector IDs and re-run — if the site currently shows that connector as
available, it'll notify. (Remember to revert afterward, or just let the
next real poll overwrite it.)

## Files

- `poll.js` — the polling + notification logic (Node 20+, no dependencies)
- `state.json` — last-seen status per connector, updated by the workflow
- `.github/workflows/poll.yml` — the schedule and commit-back step
