// EV Charger Monitor — charging status email alerts
//
// Runs inside Google Apps Script under your own Gmail account (no
// credentials leave Google). Every minute it searches for new "fully
// charged" or "stopped charging" emails from Regatta and pushes an ntfy
// notification the moment it finds one — replacing the 15-minute-minimum
// Shortcuts email-polling automation, which is an iOS limitation Shortcuts
// itself can't get around.
//
// Setup: see ../README.md "Fully charged" section.

var NTFY_TOPIC = "REPLACE_WITH_YOUR_NTFY_TOPIC";
var LABEL_NAME = "ev-notified";
var SENDER = "admin-regatta@harapanenergie.com";
var SEARCH_QUERY =
  "from:" +
  SENDER +
  ' (subject:"fully charged" OR subject:"Has Stop Charging") -label:' +
  LABEL_NAME;

function checkForChargingEmails() {
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

    UrlFetchApp.fetch("https://ntfy.sh/" + encodeURIComponent(NTFY_TOPIC), {
      method: "post",
      payload: body,
      headers: {
        Title: title,
        Priority: "urgent",
        Tags: "battery",
      },
      muteHttpExceptions: true,
    });

    thread.addLabel(label);
  });
}

// Temporary diagnostic — run this once to check whether Apps Script's
// outbound network can reach ntfy.sh at all (it may be blocked the same
// way Cloudflare Workers were). Check View > Logs (or the Execution log
// panel) after running for the results, then this function can be deleted.
function diagnosePing() {
  var targets = ["https://example.com", "https://ntfy.sh", "https://api.github.com"];
  targets.forEach(function (url) {
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      Logger.log(url + " -> " + res.getResponseCode());
    } catch (e) {
      Logger.log(url + " -> error: " + e.message);
    }
  });
}

// A GET to ntfy.sh worked but the real POST failed with "Address
// unavailable" — this isolates whether it's POST-in-general, or something
// specific to how ntfy.sh handles this POST from Apps Script.
function diagnosePost() {
  function tryPost(label, url, options) {
    try {
      var res = UrlFetchApp.fetch(url, options);
      Logger.log(label + " -> " + res.getResponseCode());
    } catch (e) {
      Logger.log(label + " -> error: " + e.message);
    }
  }

  tryPost("httpbin POST", "https://httpbin.org/post", {
    method: "post",
    payload: "test",
    muteHttpExceptions: true,
  });

  tryPost("ntfy POST plain", "https://ntfy.sh/" + encodeURIComponent(NTFY_TOPIC), {
    method: "post",
    payload: "diagnostic test",
    muteHttpExceptions: true,
  });

  tryPost("ntfy POST with headers + UA", "https://ntfy.sh/" + encodeURIComponent(NTFY_TOPIC), {
    method: "post",
    payload: "diagnostic test with headers",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ev-charger-monitor/1.0)",
      Title: "Diagnostic",
      Priority: "default",
    },
    muteHttpExceptions: true,
  });
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
