// EV Charger Monitor — trigger Worker
//
// This Worker does NOT talk to ntfy.sh or the Regatta API at all. Its only
// job is firing on a precise Cloudflare cron schedule and telling GitHub
// Actions "run the poll workflow now" via workflow_dispatch. All the real
// work (Cognito auth, status check, ntfy push) still happens inside GitHub
// Actions in the ev-refresh repo, where ntfy.sh is reachable.
//
// This exists because GitHub's own `schedule:` cron trigger is unreliable
// (observed running hours apart instead of every 5 minutes), while
// Cloudflare Cron Triggers and GitHub's workflow_dispatch API are both
// precise/immediate.
//
// Required secret: GITHUB_TOKEN (fine-grained PAT, scoped to this one repo,
// needs Actions: read and write, plus Issues: read so this Worker can skip
// dispatching entirely when the monitoring toggle (issue #1) is closed —
// saving even the lightweight check-and-skip GitHub Actions runs.
// Required var: GITHUB_REPO (e.g. "KehS97/ev-refresh")
// Required var: MONITORING_TOGGLE_ISSUE (e.g. "1")

async function isMonitoringEnabled(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/issues/${env.MONITORING_TOGGLE_ISSUE}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ev-charger-trigger-worker",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to check toggle issue state (${res.status}): ${await res.text()}`);
  }

  const issue = await res.json();
  return issue.state === "open";
}

async function dispatch(env) {
  if (!(await isMonitoringEnabled(env))) {
    console.log(`Monitoring is off (issue #${env.MONITORING_TOGGLE_ISSUE} is closed). Skipping dispatch.`);
    return "skipped";
  }

  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/poll.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ev-charger-trigger-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub dispatch failed (${res.status}): ${await res.text()}`);
  }

  return "dispatched";
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },

  // Manual trigger for testing: visit the Worker URL directly.
  async fetch(request, env, ctx) {
    try {
      const result = await dispatch(env);
      return new Response(`${result}\n`);
    } catch (err) {
      return new Response(`error: ${err.message}\n`, { status: 500 });
    }
  },
};
