/**
 * Where the RSVPs land: one spreadsheet per couple.
 *
 * Setting it up (five minutes, once per wedding):
 *   1. Make a new Google Sheet, name it after the couple.
 *   2. Extensions → Apps Script. Delete what's there, paste this in, Save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Deploy, allow the permissions it asks for, and copy the /exec URL.
 *   4. Paste that URL into ENDPOINT at the top of the invitation page.
 *
 * Changing the script later needs Deploy → Manage deployments → edit →
 * New version, or the old code keeps running.
 */

var SHEET_NAME = 'RSVPs';
var HEADERS = ['Received', 'Name', 'Attending', 'Guests', 'Dietary', 'Details', 'Language', 'Gender', 'With', 'Side', 'Updated', 'Was'];
// Side: whose guest (Bride, Groom, Both). Updated: when a guest changed their reply.
// Was: the name the reply was first sent under, so a guest who corrects their
// name keeps their seat and everything the couple set for them.

function doPost(e) {
  var lock = LockService.getScriptLock();       // two guests can reply at once
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();
    // "Yes, that was me": the earlier reply is updated, not answered a second time
    if (data.replaces) {
      var row = findReply_(sheet, data.replaces);
      if (row) {
        var cur = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
        sheet.getRange(row, 2, 1, HEADERS.length - 1).setValues([[
          data.name || cur[1], data.attending || '', data.guests || '', data.diet || '', data.dietNote || '',
          data.language || cur[6], data.gender || '', data.with || '', data.side || cur[9],
          new Date(), cur[11] || cur[1]
        ]]);
        return json_({ ok: true, updated: true });
      }
    }
    sheet.appendRow([
      data.timestamp ? new Date(data.timestamp) : new Date(),
      data.name || '',
      data.attending || '',
      data.guests || '',
      data.diet || '',
      data.dietNote || '',
      data.language || '',
      data.gender || '',                       // M or W, for the men's and women's tables
      data.with || '',                         // the others: "Sarah (W); Yossi (M); (W)"
      data.side || '',
      '',
      ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* the latest row with this name (as shown, or as first sent) */
function findReply_(sheet, name) {
  var want = String(name).trim().toLowerCase(), last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][1]).trim().toLowerCase() === want || String(vals[i][11]).trim().toLowerCase() === want) return i + 2;
  }
  return 0;
}

function doGet() {
  return json_({ ok: true, note: 'RSVP endpoint is live' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < HEADERS.length) {     // a sheet from before the newer columns: add their headings
    var from = sheet.getLastColumn() + 1;
    sheet.getRange(1, from, 1, HEADERS.length - from + 1).setValues([HEADERS.slice(from - 1)]).setFontWeight('bold');
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
