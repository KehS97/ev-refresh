// EV Charger Monitor — "fully charged" email alert
//
// Runs inside Google Apps Script under your own Gmail account (no
// credentials leave Google). Every minute it searches for a new
// "your EV is fully charged" email from Regatta and pushes an ntfy
// notification the moment it finds one — replacing the 15-minute-minimum
// Shortcuts email-polling automation, which is an iOS limitation Shortcuts
// itself can't get around.
//
// Setup: see ../README.md "Fully charged" section.

var NTFY_TOPIC = "REPLACE_WITH_YOUR_NTFY_TOPIC";
var LABEL_NAME = "ev-notified";
var SEARCH_QUERY =
  'from:admin-regatta@harapanenergie.com subject:"fully charged" -label:' + LABEL_NAME;

function checkForFullChargeEmail() {
  var label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) {
    label = GmailApp.createLabel(LABEL_NAME);
  }

  var threads = GmailApp.search(SEARCH_QUERY);

  threads.forEach(function (thread) {
    UrlFetchApp.fetch("https://ntfy.sh/" + encodeURIComponent(NTFY_TOPIC), {
      method: "post",
      payload: "Your EV is fully charged — time to move your car.",
      headers: {
        Title: "EV fully charged",
        Priority: "urgent",
        Tags: "battery",
      },
      muteHttpExceptions: true,
    });

    thread.addLabel(label);
  });
}

// Run this once manually (from the script editor) to install the 1-minute
// trigger. Re-running it is safe — it removes any existing trigger for
// this function first, so you won't end up with duplicates.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "checkForFullChargeEmail") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("checkForFullChargeEmail").timeBased().everyMinutes(1).create();
}
