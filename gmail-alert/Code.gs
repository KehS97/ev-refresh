// EV Charger Monitor — charging status email alerts
//
// Runs inside Google Apps Script under your own Gmail account (no
// credentials leave Google). Every minute, while GitHub Issue #2
// ("Charging status alerts") is open, it searches for new "fully charged"
// or "stopped charging" emails from Regatta. Close that issue to pause
// checking (e.g. once you're done charging) — independent of issue #1,
// which only controls charger-availability notifications.
//
// It does NOT call ntfy.sh directly — testing showed ntfy.sh rate-limits
// Google Apps Script's shared outbound IP pool (429s and connection
// failures, since that pool is shared across countless other Apps Script
// users' traffic). Instead it dispatches a small GitHub Actions workflow
// (.github/workflows/notify.yml in the ev-refresh repo) that relays the
// message to ntfy.sh from GitHub's network, which is reachable.
//
// Setup: see ../README.md "Charging status email alerts" section.

var GITHUB_REPO = "KehS97/ev-refresh";
var MONITORING_TOGGLE_ISSUE = 2;
var LABEL_NAME = "ev-notified";
var SENDER = "admin-regatta@harapanenergie.com";
var SEARCH_QUERY =
  "newer_than:2d from:" +
  SENDER +
  ' (subject:"fully charged" OR subject:"Has Stop Charging") -label:' +
  LABEL_NAME;

function isMonitoringEnabled(token) {
  var res = UrlFetchApp.fetch(
    "https://api.github.com/repos/" + GITHUB_REPO + "/issues/" + MONITORING_TOGGLE_ISSUE,
    {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "User-Agent": "ev-charger-gmail-alert",
      },
      muteHttpExceptions: true,
    }
  );

  if (res.getResponseCode() >= 300) {
    throw new Error(
      "Failed to check toggle issue state (" + res.getResponseCode() + "): " + res.getContentText()
    );
  }

  var issue = JSON.parse(res.getContentText());
  return issue.state === "open";
}

function checkForChargingEmails() {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN script property is not set — see README setup step."
    );
  }

  if (!isMonitoringEnabled(token)) {
    Logger.log("Monitoring is off (issue #" + MONITORING_TOGGLE_ISSUE + " is closed). Skipping check.");
    return;
  }

  var label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) {
    label = GmailApp.createLabel(LABEL_NAME);
  }

  var threads = GmailApp.search(SEARCH_QUERY);

  threads.forEach(function (thread) {
    var subject = thread.getFirstMessageSubject();
    var isFullyCharged = subject.toLowerCase().indexOf("fully charged") !== -1;

    var title = isFullyCharged ? "EV fully charged" : "EV charging stopped";
    var body = isFullyCharged
      ? "Your EV is fully charged — time to move your car."
      : "Your EV has stopped charging.";

    dispatchNotification(token, title, body);
    thread.addLabel(label);
  });
}

function dispatchNotification(token, title, message) {
  var res = UrlFetchApp.fetch(
    "https://api.github.com/repos/" + GITHUB_REPO + "/actions/workflows/notify.yml/dispatches",
    {
      method: "post",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "User-Agent": "ev-charger-gmail-alert",
      },
      contentType: "application/json",
      payload: JSON.stringify({ ref: "main", inputs: { title: title, message: message } }),
      muteHttpExceptions: true,
    }
  );

  if (res.getResponseCode() >= 300) {
    throw new Error("GitHub dispatch failed (" + res.getResponseCode() + "): " + res.getContentText());
  }
}

// Run this once manually (from the script editor) to install the 1-minute
// trigger. Re-running it is safe — it removes any existing trigger for
// this function first, so you won't end up with duplicates.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "checkForChargingEmails") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("checkForChargingEmails").timeBased().everyMinutes(1).create();
}
