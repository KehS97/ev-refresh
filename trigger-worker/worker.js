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
// Actions: read and write only)
// Required var: GITHUB_REPO (e.g. "KehS97/ev-refresh")

async function dispatch(env) {
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
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },

  // Manual trigger for testing: visit the Worker URL directly.
  async fetch(request, env, ctx) {
    try {
      await dispatch(env);
      return new Response("dispatched\n");
    } catch (err) {
      return new Response(`error: ${err.message}\n`, { status: 500 });
    }
  },
};
